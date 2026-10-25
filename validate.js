#!/usr/bin/env node
// Entry validator for the VIR registry.
// Checks every source entry under packs/ against the entry contract,
// then verifies registry.json is exactly the deterministic aggregate.
// Every violation is printed as one line: <file>: <reason-key> [detail].
// Exit codes: 0 = all entries valid and registry consistent,
//             1 = violations found.

'use strict';

const fs = require('fs');
const path = require('path');
const { aggregate, serialize } = require('./aggregate.js');

const CATEGORIES = ['game', 'ui', 'voice', 'ambient', 'fun', 'other'];
const SOURCE_LICENSES = ['original', 'game-asset', 'third-party-cc0', 'unknown'];
// Placeholder shipped with the repo so the empty packs/ directory exists.
const KEEP_FILES = ['.gitkeep'];

const RE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const RE_LOCALE = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/;
const RE_VERSION = /^\d+\.\d+\.\d+$/;
const RE_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const RE_COMMIT = /^[0-9a-f]{40}$/;

const REQUIRED = [
  'id', 'language', 'version', 'repo', 'branch', 'commit',
  'packPath', 'license', 'author', 'sourceLicense',
];

function parseArgs(argv) {
  const opts = { 'packs-dir': 'packs', registry: 'registry.json' };
  for (let i = 0; i < argv.length; i += 2) {
    const name = String(argv[i]).replace(/^--/, '');
    if (!(name in opts) || argv[i + 1] === undefined) {
      throw new Error('args.invalid:' + String(argv[i]));
    }
    opts[name] = argv[i + 1];
  }
  return opts;
}

function validateEntry(entry, relName, seenIds, errors) {
  const push = (key, detail) =>
    errors.push(relName + ': ' + key + (detail === undefined ? '' : ' ' + detail));

  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    push('entry.not-object');
    return;
  }

  for (const field of REQUIRED) {
    const v = entry[field];
    if (typeof v !== 'string' || v.length === 0) push('field.required:' + field);
  }

  if (typeof entry.id === 'string' && entry.id.length > 0) {
    if (!RE_ID.test(entry.id)) push('id.format', 'id=' + entry.id);
    if (seenIds.has(entry.id)) push('id.duplicate', 'id=' + entry.id);
    else seenIds.add(entry.id);
    const stem = path.basename(relName, '.json');
    if (stem !== entry.id) push('file.stem-mismatch', 'stem=' + stem);
  }

  if (entry.names !== undefined) {
    if (entry.names === null || typeof entry.names !== 'object' || Array.isArray(entry.names)) {
      push('names.type');
    } else {
      for (const locale of Object.keys(entry.names)) {
        if (!RE_LOCALE.test(locale)) push('names.key-locale', 'locale=' + locale);
        const v = entry.names[locale];
        if (typeof v !== 'string' || v.length === 0) push('names.value-empty', 'locale=' + locale);
      }
    }
  }

  if (entry.categories !== undefined) {
    if (!Array.isArray(entry.categories)) {
      push('categories.type');
    } else {
      for (const c of entry.categories) {
        if (!CATEGORIES.includes(c)) push('categories.value', 'value=' + c);
      }
    }
  }

  if (typeof entry.language === 'string' && entry.language.length > 0 &&
      entry.language !== 'none' && !RE_LOCALE.test(entry.language)) {
    push('language.format', 'language=' + entry.language);
  }

  if (typeof entry.version === 'string' && entry.version.length > 0 &&
      !RE_VERSION.test(entry.version)) {
    push('version.format', 'version=' + entry.version);
  }

  if (typeof entry.repo === 'string' && entry.repo.length > 0 && !RE_REPO.test(entry.repo)) {
    push('repo.format', 'repo=' + entry.repo);
  }

  if (typeof entry.commit === 'string' && entry.commit.length > 0 &&
      !RE_COMMIT.test(entry.commit)) {
    push('commit.format', 'commit=' + entry.commit);
  }

  if (typeof entry.packPath === 'string' && entry.packPath.length > 0) {
    const p = entry.packPath;
    if (p.includes('\\')) push('packPath.backslash');
    if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) push('packPath.absolute');
    const segs = p.split('/');
    if (segs.includes('..')) push('packPath.escape');
    if (segs.includes('')) push('packPath.empty-segment');
  }

  if (typeof entry.sourceLicense === 'string' && entry.sourceLicense.length > 0 &&
      !SOURCE_LICENSES.includes(entry.sourceLicense)) {
    push('sourceLicense.enum', 'value=' + entry.sourceLicense);
  }
}

// The comparison re-runs the aggregate from source entries. If the source
// itself is broken the entry errors are already collected, so the registry
// comparison is skipped instead of reporting the same fault twice.
function validateRegistryFile(registryPath, packsDir, errors) {
  const label = path.basename(registryPath);
  let raw;
  try {
    raw = fs.readFileSync(registryPath, 'utf8');
  } catch (e) {
    errors.push(label + ': registry.missing');
    return;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    errors.push(label + ': registry.parse');
    return;
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data) ||
      data.schema !== 1) {
    errors.push(label + ': registry.schema');
    return;
  }
  let expected;
  try {
    expected = serialize(aggregate(packsDir));
  } catch (e) {
    return;
  }
  if (raw !== expected) errors.push(label + ': registry.mismatch');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const errors = [];
  const seenIds = new Set();
  for (const n of fs.readdirSync(opts['packs-dir']).sort()) {
    if (KEEP_FILES.includes(n)) continue;
    if (!n.endsWith('.json')) {
      errors.push(n + ': dir.non-json');
      continue;
    }
    let entry;
    try {
      entry = JSON.parse(fs.readFileSync(path.join(opts['packs-dir'], n), 'utf8'));
    } catch (e) {
      errors.push(n + ': json.parse');
      continue;
    }
    validateEntry(entry, n, seenIds, errors);
  }
  validateRegistryFile(opts.registry, opts['packs-dir'], errors);
  if (errors.length > 0) {
    for (const line of errors) process.stderr.write(line + '\n');
    process.exit(1);
  }
  process.stdout.write('entries=' + seenIds.size + '\n');
}

module.exports = { validateEntry, validateRegistryFile, parseArgs };

if (require.main === module) {
  try {
    main();
  } catch (e) {
    process.stderr.write(e.message + '\n');
    process.exit(1);
  }
}
