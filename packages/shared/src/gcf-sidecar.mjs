// GCF sidecar codec — emits/reads the two `.gcf` sidecar artifacts produced by
// B's Rust converter (gcfc), and implements the `gcf-pack-root-v1` content root.
//
// Wire formats are taken verbatim from gcfc:
//   idx  — gcfc/src/telegram.rs:542-648  (## index / ## sections / ## anchors)
//   map  — gcfc/src/telegram.rs:649-676  (## source / ## provenance)
//   quoting obligations — gcfc/src/gcf.rs:124-219 (must_quote + push_quoted)
//
// gcf-pack-root-v1 derivation (collapsed generic adaptation of the
// graph-profile record protocol, MERGE_PLAN §4.1 / M5): each provenance row is
// canonicalised to the record `${m}|${tg}|${off}|${len}|${date}\n`; records are
// sorted by unsigned UTF-8 byte order; concatenated; SHA-256'd to lowercase hex
// and returned as `sha256:<64hex>`. Same sort→concat→sha256 discipline as the
// normative graph profile, applied to the provenance row set.
//
// Browser-safe: no Node imports. Hashing uses the global `crypto.subtle`
// (WebCrypto), matching packages/shared/src/runtime-core.mjs sha256Json; the
// CLI (tools/verify-sidecar.mjs) performs all filesystem work.

// ---------------------------------------------------------------------------
// Quoting (port of gcfc gcf.rs:124-219)
// ---------------------------------------------------------------------------

const DIGIT = (ch) => ch >= '0' && ch <= '9';

// gcf.rs:24-70 — strict JSON number grammar (incl. leading '-').
function isJsonNumber(s) {
  if (s.length === 0) return false;
  let i = 0;
  if (s[i] === '-') i += 1;
  if (i >= s.length) return false;
  if (s[i] === '0') i += 1;
  else if (DIGIT(s[i])) { while (i < s.length && DIGIT(s[i])) i += 1; }
  else return false;
  if (i < s.length && s[i] === '.') {
    i += 1;
    if (i >= s.length || !DIGIT(s[i])) return false;
    while (i < s.length && DIGIT(s[i])) i += 1;
  }
  if (i < s.length && (s[i] === 'e' || s[i] === 'E')) {
    i += 1;
    if (i < s.length && (s[i] === '+' || s[i] === '-')) i += 1;
    if (i >= s.length || !DIGIT(s[i])) return false;
    while (i < s.length && DIGIT(s[i])) i += 1;
  }
  return i === s.length;
}

// gcf.rs:74-91 — "numeric-like": could be misread as a malformed number.
function isNumericLike(s) {
  if (s.length === 0) return false;
  const c0 = s[0];
  if (c0 === '+' || c0 === '-') {
    let i = 1;
    if (i < s.length && s[i] === '.') i += 1;
    return i < s.length && DIGIT(s[i]);
  }
  if (c0 === '.') return s.length > 1 && DIGIT(s[1]);
  if (c0 === '0') return s.length > 1 && DIGIT(s[1]);
  return false;
}

// gcf.rs:95-99 — non-ASCII whitespace / bidi-invisible code points.
function isExoticSpace(cp) {
  return cp === 0x00A0 || cp === 0x1680
    || (cp >= 0x2000 && cp <= 0x200A)
    || cp === 0x2028 || cp === 0x2029 || cp === 0x202F || cp === 0x205F
    || cp === 0x3000 || cp === 0xFEFF || cp === 0x0085;
}

// gcf.rs:103-121 — does `s` contain an inline-array-looking `[`..`]`:` sequence?
function hasInlineArrayPattern(s) {
  let i = 0;
  while (i < s.length) {
    if (s[i] === '[') {
      const close = s.indexOf(']', i + 1);
      if (close === -1) return false;
      if (close + 1 < s.length && s[close + 1] === ':') return true;
      i = close + 1;
      continue;
    }
    i += 1;
  }
  return false;
}

/**
 * gcf.rs:124-164 — Section 2.4 quoting obligation. Context-independent here
 * (gcfc quotes the delimiter classes everywhere for byte-identical output).
 */
export function mustQuoteCell(s) {
  s = String(s);
  if (s === '') return true;
  if (s === '-' || s === '~' || s === '^' || s === 'true' || s === 'false') return true;
  if (s.startsWith('^{') && s.endsWith('}')) return true;
  if (isJsonNumber(s) || isNumericLike(s)) return true;
  const first = s[0];
  if (first === '#' || first === '@' || first === '.') return true;
  // Leading / trailing ASCII whitespace is structural.
  if (s.startsWith(' ') || s.startsWith('\t') || s.startsWith('\n') || s.startsWith('\r')) return true;
  if (s.endsWith(' ') || s.endsWith('\t') || s.endsWith('\n') || s.endsWith('\r')) return true;
  for (const ch of s) {
    if (ch === '"' || ch === '\\') return true;
    const cp = ch.codePointAt(0);
    if (cp <= 0x1F) return true;        // control
    if (cp >= 0x80 && cp <= 0x9F) return true; // C1
    if (ch === '|' || ch === ',') return true;
    if (isExoticSpace(cp)) return true;
  }
  if (hasInlineArrayPattern(s)) return true;
  return false;
}

/**
 * gcf.rs:167-188 — Section 2.2 canonical quoted body. Escapes only `"`, `\`,
 * the short control forms, and code points < 0x20 (lowercase `\uXXXX`); all
 * other characters (including C1 and non-ASCII) are emitted literally.
 */
export function quoted(s) {
  s = String(s);
  let out = '"';
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (cp === 0x08) out += '\\b';
    else if (cp === 0x0C) out += '\\f';
    else if (cp === 0x0A) out += '\\n';
    else if (cp === 0x0D) out += '\\r';
    else if (cp === 0x09) out += '\\t';
    else if (cp < 0x20) out += '\\u' + cp.toString(16).padStart(4, '0');
    else out += ch;
  }
  return out + '"';
}

// Every non-integer cell routes through mustQuoteCell → quoted.
function cell(s) { return mustQuoteCell(s) ? quoted(s) : String(s); }
// Integers are emitted bare (push_u64 / push_i64).
function intCell(n) {
  if (!Number.isInteger(n)) throw new Error('gcf-sidecar: expected an integer cell, got ' + JSON.stringify(n));
  return String(n);
}

// ---------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------

/**
 * idx sidecar (gcfc telegram.rs:542-648).
 * @param {{stride?: number, sections?: Array<{name:string,first:number,count:number,offset:number,t0:number,t1:number}>, anchors?: Array<{m:number,offset:number,t:number}>}} opts
 * @returns {string}
 */
export function emitIndex({ stride = 64, sections = [], anchors = [] } = {}) {
  const out = [];
  out.push('GCF profile=generic tool=gcfc-index');
  out.push('## index');
  out.push('  stride=' + intCell(stride));
  out.push('  note=byte offsets into the .gcf, 0-based');
  out.push('## sections [' + sections.length + ']{name,first,count,offset,t0,t1}');
  for (const s of sections) {
    out.push([cell(s.name), intCell(s.first), intCell(s.count), intCell(s.offset), intCell(s.t0), intCell(s.t1)].join('|'));
  }
  out.push('## anchors [' + anchors.length + ']{m,offset,t}');
  for (const a of anchors) {
    out.push([intCell(a.m), intCell(a.offset), intCell(a.t)].join('|'));
  }
  return out.join('\n') + '\n';
}

/**
 * map sidecar (gcfc telegram.rs:649-676).
 * @param {{sourceFile: string, sourceSha256: string, rows?: Array<{m:number,tg:number,off:number,len:number,date:string}>, packRoot?: string}} opts
 * @returns {string}
 */
export function emitMap({ sourceFile, sourceSha256, rows = [], packRoot } = {}) {
  if (sourceFile === undefined || sourceSha256 === undefined) {
    throw new Error('gcf-sidecar: emitMap requires sourceFile and sourceSha256');
  }
  const out = [];
  out.push('GCF profile=generic tool=gcfc-provenance');
  out.push('## source');
  out.push('  file=' + cell(sourceFile));
  out.push('  sha256=' + String(sourceSha256));
  if (packRoot !== undefined && packRoot !== null) out.push('  pack_root=' + String(packRoot));
  out.push('## provenance [' + rows.length + ']{m,tg,off,len,date}');
  for (const r of rows) {
    out.push([intCell(r.m), intCell(r.tg), intCell(r.off), intCell(r.len), cell(r.date)].join('|'));
  }
  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Parsing (strict: throw on malformed header / counts)
// ---------------------------------------------------------------------------

// Split a `|`-separated row, honouring quoted cells and backslash escapes.
function splitRow(line) {
  const out = [];
  let quotedCell = false, escaped = false, buf = '';
  for (const ch of line) {
    if (escaped) { buf += ch; escaped = false; continue; }
    if (ch === '\\' && quotedCell) { buf += ch; escaped = true; continue; }
    if (ch === '"') { quotedCell = !quotedCell; buf += ch; continue; }
    if (ch === '|' && !quotedCell) { out.push(buf); buf = ''; continue; }
    buf += ch;
  }
  out.push(buf);
  return out;
}

function parseCellStr(v) {
  if (v.startsWith('"')) return JSON.parse(v);
  return v;
}

function parseIntCell(v) {
  if (!/^-?(?:0|[1-9]\d*)$/.test(v)) {
    throw new Error('gcf-sidecar: expected integer cell, got ' + JSON.stringify(v));
  }
  return Number(v);
}

function splitLines(text) {
  const lines = String(text).split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * @param {string} text
 * @returns {{stride:number, sections:Array<{name:string,first:number,count:number,offset:number,t0:number,t1:number}>, anchors:Array<{m:number,offset:number,t:number}>}}
 */
export function parseIndex(text) {
  const lines = splitLines(text);
  let i = 0;
  if (lines[i++] !== 'GCF profile=generic tool=gcfc-index') throw new Error('gcf-sidecar: invalid index header');
  if (lines[i++] !== '## index') throw new Error('gcf-sidecar: missing ## index');
  let stride = null;
  while (i < lines.length && lines[i].startsWith('  ')) {
    const m = lines[i].slice(2).match(/^([a-z0-9_]+)=(.*)$/i);
    if (m && m[1] === 'stride') {
      if (!/^\d+$/.test(m[2])) throw new Error('gcf-sidecar: invalid stride');
      stride = Number(m[2]);
    }
    i += 1;
  }
  if (stride === null) throw new Error('gcf-sidecar: missing stride');

  const sm = lines[i++]?.match(/^## sections \[(\d+)\]\{name,first,count,offset,t0,t1\}$/);
  if (!sm) throw new Error('gcf-sidecar: malformed sections header');
  const sectionCount = Number(sm[1]);
  const sections = [];
  for (let k = 0; k < sectionCount; k++) {
    const row = lines[i++];
    if (row === undefined) throw new Error('gcf-sidecar: truncated sections');
    const c = splitRow(row);
    if (c.length !== 6) throw new Error('gcf-sidecar: section row width mismatch');
    sections.push({
      name: parseCellStr(c[0]),
      first: parseIntCell(c[1]),
      count: parseIntCell(c[2]),
      offset: parseIntCell(c[3]),
      t0: parseIntCell(c[4]),
      t1: parseIntCell(c[5]),
    });
  }

  const am = lines[i++]?.match(/^## anchors \[(\d+)\]\{m,offset,t\}$/);
  if (!am) throw new Error('gcf-sidecar: malformed anchors header');
  const anchorCount = Number(am[1]);
  const anchors = [];
  for (let k = 0; k < anchorCount; k++) {
    const row = lines[i++];
    if (row === undefined) throw new Error('gcf-sidecar: truncated anchors');
    const c = splitRow(row);
    if (c.length !== 3) throw new Error('gcf-sidecar: anchor row width mismatch');
    anchors.push({ m: parseIntCell(c[0]), offset: parseIntCell(c[1]), t: parseIntCell(c[2]) });
  }
  if (i !== lines.length) throw new Error('gcf-sidecar: trailing lines after anchors');
  return { stride, sections, anchors };
}

/**
 * @param {string} text
 * @returns {{source:{file:string,sha256:string}, rows:Array<{m:number,tg:number,off:number,len:number,date:string}>, packRoot?:string}}
 */
export function parseMap(text) {
  const lines = splitLines(text);
  let i = 0;
  if (lines[i++] !== 'GCF profile=generic tool=gcfc-provenance') throw new Error('gcf-sidecar: invalid map header');
  if (lines[i++] !== '## source') throw new Error('gcf-sidecar: missing ## source');
  let file = null, sha256 = null, packRoot;
  while (i < lines.length && lines[i].startsWith('  ')) {
    const m = lines[i].slice(2).match(/^([a-z0-9_]+)=(.*)$/i);
    if (m) {
      if (m[1] === 'file') file = parseCellStr(m[2]);
      else if (m[1] === 'sha256') sha256 = m[2];
      else if (m[1] === 'pack_root') packRoot = m[2];
    }
    i += 1;
  }
  if (file === null) throw new Error('gcf-sidecar: missing source file');
  if (!/^[0-9a-f]{64}$/.test(sha256 ?? '')) throw new Error('gcf-sidecar: invalid source sha256');

  const pm = lines[i++]?.match(/^## provenance \[(\d+)\]\{m,tg,off,len,date\}$/);
  if (!pm) throw new Error('gcf-sidecar: malformed provenance header');
  const rowCount = Number(pm[1]);
  const rows = [];
  for (let k = 0; k < rowCount; k++) {
    const row = lines[i++];
    if (row === undefined) throw new Error('gcf-sidecar: truncated provenance');
    const c = splitRow(row);
    if (c.length !== 5) throw new Error('gcf-sidecar: provenance row width mismatch');
    rows.push({
      m: parseIntCell(c[0]),
      tg: parseIntCell(c[1]),
      off: parseIntCell(c[2]),
      len: parseIntCell(c[3]),
      date: parseCellStr(c[4]),
    });
  }
  if (i !== lines.length) throw new Error('gcf-sidecar: trailing lines after provenance');
  const result = { source: { file, sha256 }, rows };
  if (packRoot !== undefined) result.packRoot = packRoot;
  return result;
}

// ---------------------------------------------------------------------------
// gcf-pack-root-v1 (M5)
// ---------------------------------------------------------------------------

/** Unsigned UTF-8 byte-order comparator (bytewise, shorter-is-prefix first). */
export function compareBytes(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

/**
 * Canonical content root over provenance rows.
 * @param {Array<{m:number,tg:number,off:number,len:number,date:string}>} rows
 * @returns {Promise<string>} `sha256:<64 lowercase hex>`
 */
export async function packRoot(rows) {
  const enc = new TextEncoder();
  const records = rows.map((r) => enc.encode(`${r.m}|${r.tg}|${r.off}|${r.len}|${r.date}\n`));
  records.sort(compareBytes);
  let total = 0;
  for (const b of records) total += b.length;
  const joined = new Uint8Array(total);
  let pos = 0;
  for (const b of records) { joined.set(b, pos); pos += b.length; }
  const digest = await crypto.subtle.digest('SHA-256', joined);
  const hex = [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
  return 'sha256:' + hex;
}
