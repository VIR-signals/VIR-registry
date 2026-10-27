#!/usr/bin/env node
// Pack liveness probe for the VIR registry.
// The validate step answers whether an entry is well formed; the probe
// answers whether the entry points at a pack that really exists. For every
// entry it checks, against the real world:
//   repo.live        - the repository exists
//   commit.live      - the pinned commit exists in that repository
//   manifest.live    - manifest.json at packPath downloads and parses
//   manifest.shape   - manifest id/version/slots line up with the entry
//   audio.live       - every file the manifest maps is downloadable
//   audio.size       - every file stays under the per-file cap
//   audio.total-size - the whole pack stays under the total cap
// Every violation prints as one line: <file>: <reason-key> [detail].
// All network goes through an injectable io seam so the test suite runs
// offline against deterministic responses.
// Exit codes: 0 = every probed entry is alive, 1 = violations found.

'use strict';

const fs = require('fs');
const path = require('path');

const MANIFEST_NAME = 'manifest.json';
const RE_COMMIT = /^[0-9a-f]{40}$/;
const RE_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PER_FILE_CAP_BYTES = 2 * 1024 * 1024;
const TOTAL_CAP_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 15 * 1000;
const ATTEMPTS = 2;
const KEEP_FILES = ['.gitkeep'];

// Production io on the global fetch of Node 18+. Retries transient network
// errors once; a status is a verdict, not an exception.
const httpIo = {
  async fetchStatus(url, opts) {
    let lastError;
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      try {
        const res = await fetch(url, {
          ...opts,
          signal: AbortSignal.timeout(TIMEOUT_MS),
          redirect: 'follow',
        });
        const len = Number(res.headers.get('content-length') || '0');
        if (res.body) await res.body.cancel().catch(() => {});
        return { status: res.status, length: Number.isFinite(len) ? len : 0 };
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError;
  },
  async fetchText(url) {
    let lastError;
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
          redirect: 'follow',
        });
        if (res.status !== 200) return { status: res.status, text: '' };
        return { status: res.status, text: await res.text() };
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError;
  },
};

function rawUrl(entry, filePath) {
  return (
    'https://raw.githubusercontent.com/' +
    entry.repo + '/' + entry.commit + '/' +
    entry.packPath + '/' + filePath
  );
}

// The commit endpoint answers both questions at once on the happy path;
// a 404 is split into repo dead or commit dead with a second lookup.
async function probeCommit(entry, io) {
  const byCommit = await io.fetchStatus(
    'https://api.github.com/repos/' + entry.repo + '/commits/' + entry.commit,
    { method: 'HEAD', headers: { Accept: 'application/vnd.github+json' } }
  );
  if (byCommit.status === 200) return [];
  const byRepo = await io.fetchStatus(
    'https://api.github.com/repos/' + entry.repo,
    { method: 'HEAD', headers: { Accept: 'application/vnd.github+json' } }
  );
  return byRepo.status === 200 ? ['commit.dead'] : ['repo.dead'];
}

async function probeEntry(entry, relName, io, errors) {
  const push = (key, detail) =>
    errors.push(relName + ': ' + key + (detail === undefined ? '' : ' ' + detail));

  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    push('entry.not-object');
    return;
  }
  if (!RE_REPO.test(String(entry.repo || ''))) {
    push('repo.unusable');
    return;
  }
  if (!RE_COMMIT.test(String(entry.commit || ''))) {
    push('commit.unusable');
    return;
  }
  if (typeof entry.packPath !== 'string' || entry.packPath.length === 0) {
    push('packPath.unusable');
    return;
  }

  for (const key of await probeCommit(entry, io)) push(key);
  if (errors.some((e) => e.startsWith(relName + ': repo.') || e.startsWith(relName + ': commit.'))) {
    return;
  }

  const manifest = await io.fetchText(rawUrl(entry, MANIFEST_NAME));
  if (manifest.status !== 200) {
    push('manifest.dead', 'status=' + manifest.status);
    return;
  }
  let pack;
  try {
    pack = JSON.parse(manifest.text);
  } catch (e) {
    push('manifest.parse');
    return;
  }
  if (pack === null || typeof pack !== 'object' || Array.isArray(pack)) {
    push('manifest.parse');
    return;
  }
  if (pack.id !== entry.id || pack.version !== entry.version) {
    push('manifest.mismatch', 'id=' + pack.id + ' version=' + pack.version);
  }
  const slots = pack.slots;
  if (slots === null || typeof slots !== 'object' || Array.isArray(slots)) {
    push('manifest.no-slots');
    return;
  }
  const slotNames = Object.keys(slots);
  if (slotNames.length === 0) {
    push('manifest.no-slots');
    return;
  }

  let total = 0;
  for (const slot of slotNames) {
    const file = slots[slot];
    if (typeof file !== 'string' || file.length === 0 || file.includes('..')) {
      push('audio.path', 'slot=' + slot);
      continue;
    }
    const head = await io.fetchStatus(rawUrl(entry, file), { method: 'HEAD' });
    if (head.status !== 200) {
      push('audio.dead', 'slot=' + slot + ' status=' + head.status);
      continue;
    }
    total += head.length;
    if (head.length > PER_FILE_CAP_BYTES) {
      push('audio.size', 'slot=' + slot + ' bytes=' + head.length);
    }
  }
  if (total > TOTAL_CAP_BYTES) {
    push('audio.total-size', 'bytes=' + total);
  }
}

// Probe the files named on the command line; with no arguments probe every
// entry under packs/. A PR that adds one entry still re-probes the whole
// registry: a small index where every entry is alive beats a fast check.
function collectTargets(argv, packsDir) {
  if (argv.length > 0) return argv.slice();
  return fs
    .readdirSync(packsDir)
    .sort()
    .filter((n) => n.endsWith('.json') && !KEEP_FILES.includes(n))
    .map((n) => path.join(packsDir, n));
}

async function main(argv) {
  const packsDir = 'packs';
  const errors = [];
  let probed = 0;
  for (const target of collectTargets(argv, packsDir)) {
    const relName = path.basename(target);
    let entry;
    try {
      entry = JSON.parse(fs.readFileSync(target, 'utf8'));
    } catch (e) {
      errors.push(relName + ': json.parse');
      continue;
    }
    probed += 1;
    await probeEntry(entry, relName, httpIo, errors);
  }
  if (errors.length > 0) {
    for (const line of errors) process.stderr.write(line + '\n');
    process.exit(1);
  }
  process.stdout.write('probed=' + probed + '\n');
}

module.exports = {
  probeEntry,
  probeCommit,
  collectTargets,
  httpIo,
  caps: { PER_FILE_CAP_BYTES, TOTAL_CAP_BYTES },
};

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => {
    process.stderr.write('probe.io: ' + (e && e.message) + '\n');
    process.exit(1);
  });
}
