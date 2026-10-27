#!/usr/bin/env node
// Test runner for the VIR registry: twelve bad-entry classes, valid
// counter-examples, aggregation determinism, filename/id linkage,
// empty-state shape, registry consistency, and CI workflow structure, plus
// an offline liveness suite for probe.js driven by deterministic io stubs.
// Runs validate.js and aggregate.js as real child processes against
// fixtures created in a fresh system temp directory per case.
// Writes a report triple (results.json / console.txt / summary.md)
// under reports/<timestamp>/ and exits 1 when anything fails.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const VALIDATE = path.join(ROOT, 'validate.js');
const AGGREGATE = path.join(ROOT, 'aggregate.js');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'registry.yml');

let passed = 0;
let failed = 0;
const failures = [];
const lines = [];

function ok(name, cond, detail) {
  if (cond) {
    passed += 1;
    lines.push('ok - ' + name);
  } else {
    failed += 1;
    failures.push(name + (detail ? ' :: ' + detail : ''));
    lines.push('not ok - ' + name + (detail ? ' :: ' + detail : ''));
  }
}

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vir-registry-test-'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

// Baseline entry that passes every rule; each bad case mutates one field.
function validEntry(overrides) {
  return Object.assign({
    id: 'demo-pack',
    language: 'none',
    version: '1.0.0',
    repo: 'someone/demo-pack',
    branch: 'main',
    commit: '0123456789abcdef0123456789abcdef01234567',
    packPath: 'pack',
    license: 'CC0-1.0',
    author: 'Someone',
    sourceLicense: 'third-party-cc0',
  }, overrides || {});
}

function runValidate(packsDir, registryPath) {
  return spawnSync(process.execPath,
    [VALIDATE, '--packs-dir', packsDir, '--registry', registryPath],
    { encoding: 'utf8' });
}

function runAggregate(packsDir, outPath) {
  return spawnSync(process.execPath,
    [AGGREGATE, '--packs-dir', packsDir, '--out', outPath],
    { encoding: 'utf8' });
}

function errOf(res) {
  return (res.stderr || '') + (res.error ? String(res.error) : '');
}

// One bad-entry case: a mutated entry plus a clean baseline sibling, so the
// validator must both flag the bad file and accept the good one.
// The aggregator must either build the index (exit 0) or refuse the broken
// input (id.duplicate is the one class aggregation itself rejects).
function badCase(name, fileName, mutate, expectKey) {
  const root = tmpRoot();
  const packsDir = path.join(root, 'packs');
  writeJson(path.join(packsDir, 'baseline-pack.json'), validEntry({ id: 'baseline-pack', repo: 'someone/baseline-pack' }));
  writeJson(path.join(packsDir, fileName), mutate(validEntry()));
  const registry = path.join(root, 'registry.json');
  const agg = runAggregate(packsDir, registry);
  ok(name + '/aggregate-sane',
    agg.status === 0 || errOf(agg).includes('id.duplicate'), errOf(agg));
  if (agg.status !== 0) fs.writeFileSync(registry, '{"schema":1,"packs":[]}');
  const res = runValidate(packsDir, registry);
  const err = errOf(res);
  ok(name + '/exit-1', res.status === 1, 'status=' + res.status);
  ok(name + '/reason', err.includes(expectKey), 'want=' + expectKey + ' got=' + err.trim());
}

// ---------------------------------------------------------------- classes 1-12

function class01To12() {
  // 1: id characters (uppercase, underscore)
  badCase('c01-id-format', 'bad-pack.json', (e) => Object.assign(e, { id: 'Bad_Pack' }), 'id.format');
  // 2: id duplicate across two files
  badCase('c02-id-duplicate', 'clone-pack.json', (e) => Object.assign(e, { id: 'baseline-pack' }), 'id.duplicate');
  // 3: filename stem differs from entry id
  badCase('c03-stem-mismatch', 'other-name.json', (e) => e, 'file.stem-mismatch');
  // 4: repo shape (protocol prefix, three segments)
  badCase('c04-repo-format', 'bad-pack.json', (e) => Object.assign(e, { id: 'bad-pack', repo: 'https://github.com/a/b' }), 'repo.format');
  // 5a: packPath parent escape
  badCase('c05a-packpath-escape', 'bad-pack.json', (e) => Object.assign(e, { id: 'bad-pack', packPath: '../outside' }), 'packPath.escape');
  // 5b: packPath backslash
  badCase('c05b-packpath-backslash', 'bad-pack.json', (e) => Object.assign(e, { id: 'bad-pack', packPath: 'pack\\sub' }), 'packPath.backslash');
  // 5c: packPath absolute
  badCase('c05c-packpath-absolute', 'bad-pack.json', (e) => Object.assign(e, { id: 'bad-pack', packPath: '/etc/pack' }), 'packPath.absolute');
  // 6a: commit missing
  badCase('c06a-commit-missing', 'bad-pack.json', (e) => { delete e.commit; return Object.assign(e, { id: 'bad-pack' }); }, 'field.required:commit');
  // 6b: commit not full 40-hex
  badCase('c06b-commit-short', 'bad-pack.json', (e) => Object.assign(e, { id: 'bad-pack', commit: 'abc123' }), 'commit.format');
  // 7: version not three numeric parts
  badCase('c07-version', 'bad-pack.json', (e) => Object.assign(e, { id: 'bad-pack', version: '1.0' }), 'version.format');
  // 8: sourceLicense outside the enum
  badCase('c08-sourcelicense', 'bad-pack.json', (e) => Object.assign(e, { id: 'bad-pack', sourceLicense: 'gpl' }), 'sourceLicense.enum');
  // 9a: required field missing
  badCase('c09a-required-missing', 'bad-pack.json', (e) => { delete e.author; return Object.assign(e, { id: 'bad-pack' }); }, 'field.required:author');
  // 9b: required field empty string
  badCase('c09b-required-empty', 'bad-pack.json', (e) => Object.assign(e, { id: 'bad-pack', license: '' }), 'field.required:license');
  // 10a: names locale key uppercase
  badCase('c10a-names-locale', 'bad-pack.json', (e) => Object.assign(e, { id: 'bad-pack', names: { 'zh-CN': 'x' } }), 'names.key-locale');
  // 10b: names value empty
  badCase('c10b-names-empty', 'bad-pack.json', (e) => Object.assign(e, { id: 'bad-pack', names: { 'zh-cn': '' } }), 'names.value-empty');
  // 11: language uppercase
  badCase('c11-language', 'bad-pack.json', (e) => Object.assign(e, { id: 'bad-pack', language: 'ZH' }), 'language.format');
  // 12: branch empty
  badCase('c12-branch-empty', 'bad-pack.json', (e) => Object.assign(e, { id: 'bad-pack', branch: '' }), 'field.required:branch');
  // extra: broken json text, non-object entry, non-json file in packs/
  const root = tmpRoot();
  const packsDir = path.join(root, 'packs');
  fs.mkdirSync(packsDir, { recursive: true });
  fs.writeFileSync(path.join(packsDir, 'broken.json'), '{"id":');
  const registry = path.join(root, 'registry.json');
  let res = runValidate(packsDir, registry);
  ok('extra/json-parse', res.status === 1 && errOf(res).includes('json.parse'), errOf(res));
  writeJson(path.join(packsDir, 'broken.json'), [1, 2]);
  res = runValidate(packsDir, registry);
  ok('extra/not-object', res.status === 1 && errOf(res).includes('entry.not-object'), errOf(res));
  fs.writeFileSync(path.join(packsDir, 'notes.txt'), 'x');
  res = runValidate(packsDir, registry);
  ok('extra/non-json-file', res.status === 1 && errOf(res).includes('dir.non-json'), errOf(res));
  // the aggregator refuses the same shape instead of skipping it silently
  const agg = runAggregate(packsDir, registry);
  ok('extra/aggregate-non-json-aborts', agg.status === 1 && errOf(agg).includes('dir.non-json'), errOf(agg));
  fs.rmSync(path.join(packsDir, 'notes.txt'));
  fs.mkdirSync(path.join(packsDir, 'subdir'));
  const aggDir = runAggregate(packsDir, registry);
  ok('extra/aggregate-subdir-aborts', aggDir.status === 1 && errOf(aggDir).includes('dir.non-json'), errOf(aggDir));
}

// --------------------------------------------------------- valid counter-examples

function validCases() {
  const root = tmpRoot();
  const packsDir = path.join(root, 'packs');
  // minimal field set
  writeJson(path.join(packsDir, 'mini-pack.json'), validEntry({ id: 'mini-pack', repo: 'someone/mini-pack' }));
  // full field set with names and categories
  writeJson(path.join(packsDir, 'full-pack.json'), validEntry({
    id: 'full-pack',
    repo: 'someone/full-pack',
    names: { 'zh-cn': 'Demo', en: 'Demo' },
    categories: ['game', 'ui'],
  }));
  const registry = path.join(root, 'registry.json');
  const agg = runAggregate(packsDir, registry);
  ok('valid/aggregate-exit-0', agg.status === 0, errOf(agg));
  const res = runValidate(packsDir, registry);
  ok('valid/exit-0', res.status === 0, errOf(res));
  ok('valid/count', (res.stdout || '').includes('entries=2'), res.stdout);
}

// ------------------------------------------------------------- determinism + empty

function determinismCases() {
  const ids = ['alpha-pack', 'beta-pack', 'gamma-pack'];
  const root = tmpRoot();
  const packsDir = path.join(root, 'packs');
  for (const id of ids) {
    writeJson(path.join(packsDir, id + '.json'), validEntry({ id, repo: 'someone/' + id }));
  }
  const out1 = path.join(root, 'r1.json');
  const out2 = path.join(root, 'r2.json');
  runAggregate(packsDir, out1);
  runAggregate(packsDir, out2);
  const b1 = fs.readFileSync(out1);
  const b2 = fs.readFileSync(out2);
  ok('determinism/byte-identical', b1.equals(b2));

  // rebuild the same content in a different write order, output must not move
  const root2 = tmpRoot();
  const packsDir2 = path.join(root2, 'packs');
  for (const id of ['gamma-pack', 'alpha-pack', 'beta-pack']) {
    writeJson(path.join(packsDir2, id + '.json'), validEntry({ id, repo: 'someone/' + id }));
  }
  const out3 = path.join(root2, 'r3.json');
  runAggregate(packsDir2, out3);
  ok('determinism/write-order-independent', b1.equals(fs.readFileSync(out3)));

  // entries sorted by id in the output
  const parsed = JSON.parse(fs.readFileSync(out1, 'utf8'));
  const outIds = parsed.packs.map((p) => p.id);
  ok('determinism/sorted-by-id',
    outIds.length === 3 && outIds[0] === 'alpha-pack' && outIds[1] === 'beta-pack' && outIds[2] === 'gamma-pack',
    JSON.stringify(outIds));
}

function emptyStateCases() {
  const root = tmpRoot();
  const packsDir = path.join(root, 'packs');
  fs.mkdirSync(packsDir, { recursive: true });
  fs.writeFileSync(path.join(packsDir, '.gitkeep'), '');
  const registry = path.join(root, 'registry.json');
  const agg = runAggregate(packsDir, registry);
  ok('empty/aggregate-exit-0', agg.status === 0, errOf(agg));
  ok('empty/exact-bytes',
    fs.readFileSync(registry, 'utf8') === '{"schema":1,"packs":[]}',
    fs.readFileSync(registry, 'utf8'));
  const res = runValidate(packsDir, registry);
  ok('empty/validate-exit-0', res.status === 0, errOf(res));
}

// ------------------------------------------------------ filename/id linkage + registry

function linkageAndRegistryCases() {
  // rename without content change: file b.json still says id=a
  const root = tmpRoot();
  const packsDir = path.join(root, 'packs');
  writeJson(path.join(packsDir, 'renamed.json'), validEntry({ id: 'demo-pack' }));
  const registry = path.join(root, 'registry.json');
  runAggregate(packsDir, registry);
  let res = runValidate(packsDir, registry);
  ok('linkage/rename-caught', res.status === 1 && errOf(res).includes('file.stem-mismatch'), errOf(res));

  // content change without rename: file keeps name, id moves
  const root2 = tmpRoot();
  const packsDir2 = path.join(root2, 'packs');
  writeJson(path.join(packsDir2, 'demo-pack.json'), validEntry({ id: 'moved-pack' }));
  const registry2 = path.join(root2, 'registry.json');
  runAggregate(packsDir2, registry2);
  res = runValidate(packsDir2, registry2);
  ok('linkage/content-caught', res.status === 1 && errOf(res).includes('file.stem-mismatch'), errOf(res));

  // source edited after aggregation, registry left stale
  const root3 = tmpRoot();
  const packsDir3 = path.join(root3, 'packs');
  writeJson(path.join(packsDir3, 'demo-pack.json'), validEntry());
  const registry3 = path.join(root3, 'registry.json');
  runAggregate(packsDir3, registry3);
  writeJson(path.join(packsDir3, 'demo-pack.json'), validEntry({ version: '2.0.0' }));
  res = runValidate(packsDir3, registry3);
  ok('registry/stale-mismatch', res.status === 1 && errOf(res).includes('registry.mismatch'), errOf(res));

  // registry reformatted by hand (same data, different bytes)
  const root4 = tmpRoot();
  const packsDir4 = path.join(root4, 'packs');
  writeJson(path.join(packsDir4, 'demo-pack.json'), validEntry());
  const registry4 = path.join(root4, 'registry.json');
  runAggregate(packsDir4, registry4);
  fs.writeFileSync(registry4, JSON.stringify(JSON.parse(fs.readFileSync(registry4, 'utf8')), null, 2));
  res = runValidate(packsDir4, registry4);
  ok('registry/reformat-mismatch', res.status === 1 && errOf(res).includes('registry.mismatch'), errOf(res));

  // wrong schema value
  fs.writeFileSync(registry4, '{"schema":2,"packs":[]}');
  res = runValidate(packsDir4, registry4);
  ok('registry/schema', res.status === 1 && errOf(res).includes('registry.schema'), errOf(res));

  // missing registry file
  res = runValidate(packsDir4, path.join(root4, 'gone.json'));
  ok('registry/missing', res.status === 1 && errOf(res).includes('registry.missing'), errOf(res));
}

// ------------------------------------------------------------------ workflow + args

function workflowCases() {
  let raw = '';
  try {
    raw = fs.readFileSync(WORKFLOW, 'utf8');
  } catch (e) {
    ok('workflow/parses', false, String(e.message));
    return;
  }
  const linesAll = raw.split(/\r?\n/);
  ok('workflow/no-tab', !raw.includes('\t'));
  ok('workflow/pull-request-trigger', /pull_request/.test(raw));
  ok('workflow/step-validate', raw.includes('node validate.js'));
  ok('workflow/step-aggregate', raw.includes('node aggregate.js'));
  ok('workflow/step-compare', /diff --no-index/.test(raw));
  // every non-empty, non-comment line is a mapping key, a list item, or an
  // indented scalar: cheap YAML sanity without a parser
  const shape = /^([ ]*)([A-Za-z0-9_.$-]+:($| .*)|- .+)$/;
  const scalar = /^ +[^\s:#][^:]*$/;
  let shapeOk = true;
  const detail = [];
  for (let i = 0; i < linesAll.length; i += 1) {
    const ln = linesAll[i];
    if (ln.trim() === '' || ln.trim().startsWith('#')) continue;
    if (!shape.test(ln) && !scalar.test(ln)) {
      shapeOk = false;
      detail.push('L' + (i + 1) + '=' + ln);
    }
  }
  ok('workflow/line-shape', shapeOk, detail.join('|'));
}

function argsCases() {
  const res = spawnSync(process.execPath, [AGGREGATE, '--bogus', 'x'], { encoding: 'utf8' });
  ok('args/invalid-rejected', res.status === 1 && errOf(res).includes('args.invalid'), errOf(res));
}

// ------------------------------------------------------------- probe suite

// Offline coverage for probe.js: entry defense, repo and commit liveness,
// manifest shape, audio path and cap boundaries, target collection, and
// the probe wiring inside the CI workflow. Every network answer comes from
// a deterministic stub io keyed by url, so the suite never touches the real
// network. These cases are async because probeEntry awaits its io seam.

const probe = require(path.join(ROOT, 'probe.js'));

const PROBE_REPO = 'someone/demo-pack';
const PROBE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const COMMIT_URL = 'https://api.github.com/repos/' + PROBE_REPO + '/commits/' + PROBE_COMMIT;
const REPO_URL = 'https://api.github.com/repos/' + PROBE_REPO;
const RAW_BASE = 'https://raw.githubusercontent.com/' + PROBE_REPO + '/' + PROBE_COMMIT + '/pack/';
const MANIFEST_URL = RAW_BASE + 'manifest.json';

// The minimal entry shape probeEntry consumes: identity fields for the
// manifest comparison plus the three locator fields.
function probeFixture(overrides) {
  return Object.assign({
    id: 'demo-pack',
    version: '1.0.0',
    repo: PROBE_REPO,
    commit: PROBE_COMMIT,
    packPath: 'pack',
  }, overrides || {});
}

function manifestBody(fields) {
  return JSON.stringify(Object.assign({ id: 'demo-pack', version: '1.0.0' }, fields || {}));
}

// A live commit endpoint plus a fetchable manifest for the given slot map;
// per-file answers are added by the caller.
function liveBase(slots) {
  const responses = {};
  responses[COMMIT_URL] = { status: 200 };
  responses[MANIFEST_URL] = { status: 200, text: manifestBody({ slots: slots }) };
  return responses;
}

// Stub io seam: answers are keyed by url and any unplanned url throws, so a
// missing fixture can never pass silently. Every call is recorded so cases
// can also assert the exact traffic that happened.
function stubIo(responses) {
  const calls = [];
  return {
    calls,
    async fetchStatus(url) {
      calls.push('status ' + url);
      const hit = responses[url];
      if (!hit) throw new Error('unplanned status request ' + url);
      return { status: hit.status, length: hit.length || 0 };
    },
    async fetchText(url) {
      calls.push('text ' + url);
      const hit = responses[url];
      if (!hit) throw new Error('unplanned text request ' + url);
      return { status: hit.status, text: hit.text || '' };
    },
  };
}

async function runProbe(entry, responses) {
  const io = stubIo(responses);
  const errors = [];
  await probe.probeEntry(entry, 'demo-pack.json', io, errors);
  return { errors, calls: io.calls };
}

// The total cap boundary needs several files: every file must stay within
// the per-file cap, so the fill is whole files of exactly the per-file cap
// plus one remainder file, summing to exactly the total cap.
function capFillSizes() {
  const per = probe.caps.PER_FILE_CAP_BYTES;
  const total = probe.caps.TOTAL_CAP_BYTES;
  const sizes = [];
  const count = Math.ceil(total / per);
  for (let i = 0; i < count - 1; i += 1) sizes.push(per);
  sizes.push(total - per * (count - 1));
  return sizes;
}

// Slot map and responses for a pack whose files add up to the total cap;
// the extra flag appends a one-byte file that pushes the sum one over.
function totalCapResponses(slots, sizes, extra) {
  const responses = {};
  responses[COMMIT_URL] = { status: 200 };
  sizes.forEach((size, i) => {
    const file = 'part' + i + '.ogg';
    slots['s' + i] = file;
    responses[RAW_BASE + file] = { status: 200, length: size };
  });
  if (extra) {
    slots.extra = 'tiny.ogg';
    responses[RAW_BASE + 'tiny.ogg'] = { status: 200, length: 1 };
  }
  responses[MANIFEST_URL] = { status: 200, text: manifestBody({ slots: slots }) };
  return responses;
}

const probeAsyncCases = [
  ['probe/live', async () => {
    const responses = liveBase({ hello: 'hello.ogg', bye: 'bye.ogg' });
    responses[RAW_BASE + 'hello.ogg'] = { status: 200, length: 1024 };
    responses[RAW_BASE + 'bye.ogg'] = { status: 200, length: 2048 };
    const r = await runProbe(probeFixture(), responses);
    ok('probe/live-clean', r.errors.length === 0, r.errors.join('|'));
    ok('probe/live-touches',
      r.calls.length === 4 &&
      r.calls.includes('status ' + COMMIT_URL) &&
      r.calls.includes('text ' + MANIFEST_URL) &&
      r.calls.includes('status ' + RAW_BASE + 'hello.ogg') &&
      r.calls.includes('status ' + RAW_BASE + 'bye.ogg'),
      r.calls.join('|'));
  }],
  ['probe/repo-dead', async () => {
    const responses = {};
    responses[COMMIT_URL] = { status: 404 };
    responses[REPO_URL] = { status: 404 };
    const r = await runProbe(probeFixture(), responses);
    ok('probe/repo-dead/reason',
      r.errors.length === 1 && r.errors[0].includes('repo.dead'), r.errors.join('|'));
    ok('probe/repo-dead/stops-early', r.calls.length === 2, r.calls.join('|'));
  }],
  ['probe/commit-dead', async () => {
    const responses = {};
    responses[COMMIT_URL] = { status: 404 };
    responses[REPO_URL] = { status: 200 };
    const r = await runProbe(probeFixture(), responses);
    ok('probe/commit-dead/reason',
      r.errors.length === 1 && r.errors[0].includes('commit.dead'), r.errors.join('|'));
    ok('probe/commit-dead/stops-early', r.calls.length === 2, r.calls.join('|'));
  }],
  ['probe/manifest-dead', async () => {
    const responses = {};
    responses[COMMIT_URL] = { status: 200 };
    responses[MANIFEST_URL] = { status: 404, text: '' };
    const r = await runProbe(probeFixture(), responses);
    ok('probe/manifest-dead',
      r.errors.length === 1 && r.errors[0].includes('manifest.dead status=404'),
      r.errors.join('|'));
  }],
  ['probe/manifest-parse-bad-json', async () => {
    const responses = {};
    responses[COMMIT_URL] = { status: 200 };
    responses[MANIFEST_URL] = { status: 200, text: '{"id":' };
    const r = await runProbe(probeFixture(), responses);
    ok('probe/manifest-parse-bad-json',
      r.errors.length === 1 && r.errors[0].includes('manifest.parse'), r.errors.join('|'));
  }],
  ['probe/manifest-parse-non-object', async () => {
    for (const text of ['[1,2]', 'null']) {
      const responses = {};
      responses[COMMIT_URL] = { status: 200 };
      responses[MANIFEST_URL] = { status: 200, text: text };
      const r = await runProbe(probeFixture(), responses);
      if (!(r.errors.length === 1 && r.errors[0].includes('manifest.parse'))) {
        ok('probe/manifest-parse-non-object', false, text + ' gave ' + r.errors.join('|'));
        return;
      }
    }
    ok('probe/manifest-parse-non-object', true);
  }],
  ['probe/manifest-mismatch-id', async () => {
    const responses = {};
    responses[COMMIT_URL] = { status: 200 };
    responses[MANIFEST_URL] = {
      status: 200,
      text: manifestBody({ id: 'other-pack', slots: { hello: 'hello.ogg' } }),
    };
    responses[RAW_BASE + 'hello.ogg'] = { status: 200, length: 10 };
    const r = await runProbe(probeFixture(), responses);
    ok('probe/manifest-mismatch-id',
      r.errors.length === 1 &&
      r.errors[0].includes('manifest.mismatch id=other-pack version=1.0.0'),
      r.errors.join('|'));
  }],
  ['probe/manifest-mismatch-version', async () => {
    const responses = {};
    responses[COMMIT_URL] = { status: 200 };
    responses[MANIFEST_URL] = {
      status: 200,
      text: manifestBody({ version: '9.9.9', slots: { hello: 'hello.ogg' } }),
    };
    responses[RAW_BASE + 'hello.ogg'] = { status: 200, length: 10 };
    const r = await runProbe(probeFixture(), responses);
    ok('probe/manifest-mismatch-version',
      r.errors.length === 1 &&
      r.errors[0].includes('manifest.mismatch id=demo-pack version=9.9.9'),
      r.errors.join('|'));
  }],
  ['probe/manifest-no-slots', async () => {
    const variants = [
      ['missing', JSON.stringify({ id: 'demo-pack', version: '1.0.0' })],
      ['empty', manifestBody({ slots: {} })],
      ['array', manifestBody({ slots: [] })],
    ];
    for (const item of variants) {
      const responses = {};
      responses[COMMIT_URL] = { status: 200 };
      responses[MANIFEST_URL] = { status: 200, text: item[1] };
      const r = await runProbe(probeFixture(), responses);
      ok('probe/manifest-no-slots/' + item[0],
        r.errors.length === 1 && r.errors[0].includes('manifest.no-slots'),
        item[0] + ' gave ' + r.errors.join('|'));
    }
  }],
  ['probe/audio-dead', async () => {
    const responses = liveBase({ hello: 'hello.ogg' });
    responses[RAW_BASE + 'hello.ogg'] = { status: 404 };
    const r = await runProbe(probeFixture(), responses);
    ok('probe/audio-dead',
      r.errors.length === 1 && r.errors[0].includes('audio.dead slot=hello status=404'),
      r.errors.join('|'));
  }],
  ['probe/audio-path-empty', async () => {
    const responses = liveBase({ hello: '' });
    const r = await runProbe(probeFixture(), responses);
    ok('probe/audio-path-empty/reason',
      r.errors.length === 1 && r.errors[0].includes('audio.path slot=hello'),
      r.errors.join('|'));
    ok('probe/audio-path-empty/no-head', r.calls.length === 2, r.calls.join('|'));
  }],
  ['probe/audio-path-parent', async () => {
    const responses = liveBase({ hello: '../secret.ogg' });
    const r = await runProbe(probeFixture(), responses);
    ok('probe/audio-path-parent/reason',
      r.errors.length === 1 && r.errors[0].includes('audio.path slot=hello'),
      r.errors.join('|'));
    ok('probe/audio-path-parent/no-head', r.calls.length === 2, r.calls.join('|'));
  }],
  ['probe/audio-size-at-cap', async () => {
    const responses = liveBase({ big: 'big.ogg' });
    responses[RAW_BASE + 'big.ogg'] = { status: 200, length: probe.caps.PER_FILE_CAP_BYTES };
    const r = await runProbe(probeFixture(), responses);
    ok('probe/audio-size-at-cap', r.errors.length === 0, r.errors.join('|'));
  }],
  ['probe/audio-size-over-one', async () => {
    const responses = liveBase({ big: 'big.ogg' });
    responses[RAW_BASE + 'big.ogg'] = {
      status: 200,
      length: probe.caps.PER_FILE_CAP_BYTES + 1,
    };
    const r = await runProbe(probeFixture(), responses);
    ok('probe/audio-size-over-one',
      r.errors.length === 1 &&
      r.errors[0].includes('audio.size slot=big bytes=' + (probe.caps.PER_FILE_CAP_BYTES + 1)),
      r.errors.join('|'));
  }],
  ['probe/audio-total-at-cap', async () => {
    const sizes = capFillSizes();
    const responses = totalCapResponses({}, sizes, false);
    const r = await runProbe(probeFixture(), responses);
    const sum = sizes.reduce((a, b) => a + b, 0);
    const fillSane = sum === probe.caps.TOTAL_CAP_BYTES &&
      Math.max(...sizes) <= probe.caps.PER_FILE_CAP_BYTES;
    ok('probe/audio-total-at-cap', fillSane && r.errors.length === 0,
      'sum=' + sum + ' errors=' + r.errors.join('|'));
  }],
  ['probe/audio-total-over-one', async () => {
    const sizes = capFillSizes();
    const responses = totalCapResponses({}, sizes, true);
    const r = await runProbe(probeFixture(), responses);
    ok('probe/audio-total-over-one',
      r.errors.length === 1 &&
      r.errors[0].includes('audio.total-size bytes=' + (probe.caps.TOTAL_CAP_BYTES + 1)),
      r.errors.join('|'));
  }],
  ['probe/entry-not-object', async () => {
    for (const bad of [null, [1, 2]]) {
      const r = await runProbe(bad, {});
      if (!(r.errors.length === 1 && r.errors[0].includes('entry.not-object') &&
            r.calls.length === 0)) {
        ok('probe/entry-not-object', false,
          (bad === null ? 'null' : 'array') + ' gave ' + r.errors.join('|') +
          ' calls=' + r.calls.length);
        return;
      }
    }
    ok('probe/entry-not-object', true);
  }],
  ['probe/entry-repo-unusable', async () => {
    const r = await runProbe(probeFixture({ repo: 'https://github.com/a/b' }), {});
    ok('probe/entry-repo-unusable',
      r.errors.length === 1 && r.errors[0].includes('repo.unusable') && r.calls.length === 0,
      r.errors.join('|') + ' calls=' + r.calls.length);
  }],
  ['probe/entry-commit-unusable', async () => {
    const r = await runProbe(probeFixture({ commit: 'abc123' }), {});
    ok('probe/entry-commit-unusable',
      r.errors.length === 1 && r.errors[0].includes('commit.unusable') && r.calls.length === 0,
      r.errors.join('|') + ' calls=' + r.calls.length);
  }],
  ['probe/entry-packpath-unusable', async () => {
    const r = await runProbe(probeFixture({ packPath: '' }), {});
    ok('probe/entry-packpath-unusable',
      r.errors.length === 1 && r.errors[0].includes('packPath.unusable') && r.calls.length === 0,
      r.errors.join('|') + ' calls=' + r.calls.length);
  }],
];

async function probeCases() {
  // caps sanity first: the boundary cases above read these numbers
  ok('probe/caps-sane',
    Number.isInteger(probe.caps.PER_FILE_CAP_BYTES) && probe.caps.PER_FILE_CAP_BYTES > 0 &&
    Number.isInteger(probe.caps.TOTAL_CAP_BYTES) &&
    probe.caps.TOTAL_CAP_BYTES >= probe.caps.PER_FILE_CAP_BYTES,
    'per=' + probe.caps.PER_FILE_CAP_BYTES + ' total=' + probe.caps.TOTAL_CAP_BYTES);

  for (const item of probeAsyncCases) {
    try {
      await item[1]();
    } catch (e) {
      ok(item[0], false, e && e.message ? e.message : String(e));
    }
  }

  // explicit argv passes through untouched, without reading the directory
  const passthrough = probe.collectTargets(['x/a.json', 'y/b.json'], path.join('no', 'such', 'dir'));
  ok('probe/collect-explicit',
    Array.isArray(passthrough) && passthrough.length === 2 &&
    passthrough[0] === 'x/a.json' && passthrough[1] === 'y/b.json',
    JSON.stringify(passthrough));

  // with no argv only json entries are listed; the placeholder file and
  // the non-json file stay out
  const listDir = tmpRoot();
  fs.writeFileSync(path.join(listDir, 'solo-pack.json'), '{}');
  fs.writeFileSync(path.join(listDir, '.gitkeep'), '');
  fs.writeFileSync(path.join(listDir, 'notes.txt'), 'x');
  const listed = probe.collectTargets([], listDir);
  ok('probe/collect-default',
    listed.length === 1 && listed[0] === path.join(listDir, 'solo-pack.json'),
    JSON.stringify(listed));

  // the workflow must keep the probe job and its step wired into CI
  let wfRaw = '';
  try {
    wfRaw = fs.readFileSync(WORKFLOW, 'utf8');
  } catch (e) {
    wfRaw = '';
  }
  ok('workflow/probe-job', /^ {2}probe:\s*$/m.test(wfRaw), 'probe job key missing');
  ok('workflow/step-probe', wfRaw.includes('node probe.js'), 'probe step missing');
}

// ------------------------------------------------------------------------- report

function writeReport() {
  const stamp = new Date().toISOString().replace(/:/g, '-');
  const dir = path.join(ROOT, 'reports', stamp);
  fs.mkdirSync(dir, { recursive: true });
  const total = passed + failed;
  const results = {
    suite: 'vir-registry',
    started: stamp,
    total,
    passed,
    failed,
    failures,
  };
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(dir, 'console.txt'), lines.join('\n') + '\n');
  const summary = [
    '# vir-registry test report',
    '',
    '- timestamp: ' + stamp,
    '- total: ' + total,
    '- passed: ' + passed,
    '- failed: ' + failed,
    '',
    failed === 0 ? 'all green' : 'failures:',
    ...(failed === 0 ? [] : failures.map((f) => '- ' + f)),
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(dir, 'summary.md'), summary);
  process.stdout.write(lines.join('\n') + '\n');
  process.stdout.write('passed=' + passed + ' failed=' + failed + '\n');
  process.stdout.write('report=' + dir + '\n');
}

// The suite mixes sync child-process cases with async probe cases, so the
// tail runs only after every case has settled; the report triple and the
// exit code therefore always cover the full run.
async function runAll() {
  class01To12();
  validCases();
  determinismCases();
  emptyStateCases();
  linkageAndRegistryCases();
  workflowCases();
  argsCases();
  await probeCases();
}

runAll().then(
  () => {
    writeReport();
    process.exit(failed === 0 ? 0 : 1);
  },
  (e) => {
    ok('harness/no-crash', false, e && e.message ? e.message : String(e));
    writeReport();
    process.exit(1);
  }
);
