#!/usr/bin/env node
// Deterministic aggregator for the VIR registry.
// Reads every source entry under packs/, sorts by id, and writes the
// merged index to registry.json as compact JSON.
// Same input always produces identical output bytes: no timestamps,
// no randomness, no environment dependent fields.
// Exit codes: 0 = written, 1 = bad input or bad arguments.

'use strict';

const fs = require('fs');
const path = require('path');

// Canonical key order applied to every entry so the output depends only
// on entry content, never on the key order typed by the author.
const KEY_ORDER = [
  'id', 'names', 'categories', 'language', 'author', 'version',
  'repo', 'branch', 'commit', 'packPath', 'license', 'sourceLicense',
];

function parseArgs(argv) {
  const opts = { 'packs-dir': 'packs', out: 'registry.json' };
  for (let i = 0; i < argv.length; i += 2) {
    const name = String(argv[i]).replace(/^--/, '');
    if (!(name in opts) || argv[i + 1] === undefined) {
      throw new Error('args.invalid:' + String(argv[i]));
    }
    opts[name] = argv[i + 1];
  }
  return opts;
}

function readEntry(file, relName) {
  const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error('entry.not-object:' + relName);
  }
  if (typeof entry.id !== 'string' || entry.id.length === 0) {
    throw new Error('field.required:id:' + relName);
  }
  return entry;
}

function orderEntry(entry) {
  const out = {};
  for (const key of KEY_ORDER) {
    if (key in entry) out[key] = entry[key];
  }
  return out;
}

function aggregate(packsDir) {
  const names = fs.readdirSync(packsDir).sort();
  // Same rule as the validator: anything in the source area that is not a
  // JSON entry (and not the shipped placeholder) aborts the run instead of
  // being silently skipped.
  for (const n of names) {
    if (n === '.gitkeep') continue;
    if (!n.endsWith('.json')) {
      throw new Error('dir.non-json:' + n);
    }
  }
  const byId = new Map();
  for (const relName of names) {
    if (relName === '.gitkeep') continue;
    const entry = readEntry(path.join(packsDir, relName), relName);
    if (byId.has(entry.id)) {
      throw new Error('id.duplicate:' + entry.id + ':' + relName);
    }
    byId.set(entry.id, entry);
  }
  const packs = [...byId.keys()].sort().map((id) => orderEntry(byId.get(id)));
  return { schema: 1, packs };
}

function serialize(data) {
  return JSON.stringify(data);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const data = aggregate(opts['packs-dir']);
  fs.writeFileSync(opts.out, serialize(data));
  process.stdout.write('entries=' + data.packs.length + '\n');
}

module.exports = { aggregate, serialize, parseArgs, KEY_ORDER };

if (require.main === module) {
  try {
    main();
  } catch (e) {
    process.stderr.write(e.message + '\n');
    process.exit(1);
  }
}
