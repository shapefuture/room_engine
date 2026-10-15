#!/usr/bin/env node
// tools/verify-sidecar.mjs — byte-precision verifier for the gcfc idx/map
// sidecars against their `.gcf` twin.
//
//   node tools/verify-sidecar.mjs <prefix> [<source.json>]
//
// Reads <prefix>.gcf, <prefix>.idx.gcf, <prefix>.map.gcf. Checks:
//   (a) every section.offset lands exactly at a line starting `## ` in the .gcf
//   (b) every anchor.offset lands exactly at the START of its row line
//   (c) per-section row counts match the declared counts (and totals agree)
//   (d) map source.sha256 == actual sha256 of <source.json>, if provided
//   (e) recomputed packRoot(rows) == map `pack_root=` header, if present
// Exits non-zero with a precise message on the first failure.

import fs from 'node:fs';
import crypto from 'node:crypto';
import { parseIndex, parseMap, packRoot } from '../packages/shared/src/gcf-sidecar.mjs';

function fail(msg) {
  console.error('SIDECAR VERIFY: FAIL — ' + msg);
  process.exit(1);
}

const [, , prefix, sourcePath] = process.argv;
if (!prefix) fail('usage: node tools/verify-sidecar.mjs <prefix> [<source.json>]');

let gcf;
let idxText;
let mapText;
try {
  gcf = fs.readFileSync(prefix + '.gcf');
  idxText = fs.readFileSync(prefix + '.idx.gcf', 'utf8');
  mapText = fs.readFileSync(prefix + '.map.gcf', 'utf8');
} catch (e) {
  fail('cannot read sidecar files for prefix ' + JSON.stringify(prefix) + ': ' + e.message);
}

let index;
let map;
try {
  index = parseIndex(idxText);
  map = parseMap(mapText);
} catch (e) {
  fail('parse error: ' + e.message);
}

// Byte-addressed line table for the .gcf twin.
const lines = [];
{
  let start = 0;
  for (let i = 0; i <= gcf.length; i++) {
    if (i === gcf.length || gcf[i] === 0x0a) {
      lines.push({ start, end: i, text: gcf.toString('utf8', start, i) });
      start = i + 1;
    }
  }
}
const byStart = new Map(lines.map((l, idx) => [l.start, idx]));

function atLineStart(offset) {
  return offset === 0 || gcf[offset - 1] === 0x0a;
}
function lineTextAt(offset) {
  const idx = byStart.get(offset);
  return idx === undefined ? null : lines[idx].text;
}

// (a) Section header offsets land on a `## ` line.
for (const s of index.sections) {
  if (!atLineStart(s.offset)) fail(`section ${JSON.stringify(s.name)} offset ${s.offset} is not a line start`);
  const text = lineTextAt(s.offset);
  if (text === null || !text.startsWith('## ')) {
    fail(`section ${JSON.stringify(s.name)} offset ${s.offset} does not land on a '## ' line (got ${JSON.stringify(text)})`);
  }
}

// (b) Anchor offsets land at the exact start of their row line.
for (const a of index.anchors) {
  if (!atLineStart(a.offset)) fail(`anchor m=${a.m} offset ${a.offset} is not a line start`);
  const text = lineTextAt(a.offset);
  if (text === null || !(text.startsWith(`${a.m}|`) || text.startsWith(`"${a.m}"|`))) {
    fail(`anchor m=${a.m} offset ${a.offset} does not start its row (got ${JSON.stringify(text === null ? null : text.slice(0, 32))})`);
  }
}

// (c) Declared counts vs actual rows in each section, and anchor coverage.
let totalRows = 0;
let expectedAnchors = 0;
for (const s of index.sections) {
  const li = byStart.get(s.offset);
  let count = 0;
  for (let j = li + 1; j < lines.length; j++) {
    if (lines[j].text.startsWith('## ')) break;
    if (lines[j].text === '') continue;
    count += 1;
    if ((count - 1) % index.stride === 0) expectedAnchors += 1;
  }
  if (count !== s.count) {
    fail(`section ${JSON.stringify(s.name)} count mismatch: declared ${s.count}, found ${count}`);
  }
  totalRows += count;
}
if (totalRows !== map.rows.length) {
  fail(`row total mismatch: ${totalRows} rows in .gcf sections vs ${map.rows.length} in map`);
}
if (expectedAnchors !== index.anchors.length) {
  fail(`anchor count mismatch: expected ${expectedAnchors}, declared ${index.anchors.length}`);
}

// (d) Optional source-file hash cross-check.
if (sourcePath !== undefined) {
  let actual;
  try {
    actual = crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
  } catch (e) {
    fail('cannot read source file ' + JSON.stringify(sourcePath) + ': ' + e.message);
  }
  if (actual !== map.source.sha256) {
    fail(`source sha256 mismatch: map=${map.source.sha256} actual=${actual}`);
  }
}

// (e) Optional pack-root cross-check.
if (map.packRoot !== undefined) {
  const computed = await packRoot(map.rows);
  if (computed !== map.packRoot) {
    fail(`pack_root mismatch: map=${map.packRoot} computed=${computed}`);
  }
}

console.log(`SIDECAR VERIFY: PASS (${index.sections.length} sections, ${index.anchors.length} anchors, ${map.rows.length} rows)`);
