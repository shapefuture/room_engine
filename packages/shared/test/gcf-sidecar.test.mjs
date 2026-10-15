import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  emitIndex,
  emitMap,
  parseIndex,
  parseMap,
  mustQuoteCell,
  quoted,
  compareBytes,
  packRoot,
} from '../src/gcf-sidecar.mjs';

// ---- fixtures -------------------------------------------------------------

const HOSTILE = ['', '-', '~', 'true', '123', 'a|b', 'a,b', '#x', ' x', 'йцукен'];

// Small deterministic LCG so runs are reproducible.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// ---- 1. roundtrip ---------------------------------------------------------

test('emit→parse roundtrip for 100 random provenance rows', () => {
  const r = rng(0x5eed);
  const rows = [];
  for (let i = 0; i < 100; i++) {
    const date = i % 3 === 0
      ? HOSTILE[r() % HOSTILE.length]
      : `2025-08-26T11:30:${pad(i % 60)}`;
    rows.push({
      m: i,
      tg: (r() % 2000001) - 1000000,
      off: r() % 100000,
      len: r() % 2000,
      date,
    });
  }
  const parsed = parseMap(emitMap({ sourceFile: 'result.json', sourceSha256: 'a'.repeat(64), rows }));
  assert.deepEqual(parsed.rows, rows);
});

test('emit→parse roundtrip for 100 random index sections/anchors', () => {
  const r = rng(0xc0ffee);
  const sections = [];
  for (let i = 0; i < 100; i++) {
    sections.push({
      name: HOSTILE[i % HOSTILE.length],
      first: r() % 1000,
      count: r() % 5000,
      offset: r() % 100000,
      t0: r() % 2000000000,
      t1: r() % 2000000000,
    });
  }
  const anchors = [];
  for (let i = 0; i < 100; i++) {
    anchors.push({ m: i, offset: r() % 100000, t: r() % 2000000000 });
  }
  const parsed = parseIndex(emitIndex({ stride: 64, sections, anchors }));
  assert.equal(parsed.stride, 64);
  assert.deepEqual(parsed.sections, sections);
  assert.deepEqual(parsed.anchors, anchors);
});

test('parse throws on malformed header / counts', () => {
  assert.throws(() => parseIndex('GCF profile=generic tool=nope\n## index\n  stride=1\n'), /invalid index header/);
  assert.throws(() => parseIndex('GCF profile=generic tool=gcfc-index\n## index\n  note=x\n'), /missing stride/);
  assert.throws(
    () => parseIndex('GCF profile=generic tool=gcfc-index\n## index\n  stride=64\n## sections [2]{name,first,count,offset,t0,t1}\n0|0|1|1|0|0\n'),
    /truncated sections/,
  );
  assert.throws(
    () => parseIndex('GCF profile=generic tool=gcfc-index\n## index\n  stride=64\n## sections [1]{name,first,count,offset,t0,t1}\n0|0|1\n'),
    /section row width mismatch/,
  );
  assert.throws(() => parseMap('GCF profile=generic tool=nope\n'), /invalid map header/);
  assert.throws(
    () => parseMap('GCF profile=generic tool=gcfc-provenance\n## source\n  file=x\n  sha256=zz\n## provenance [0]{m,tg,off,len,date}\n'),
    /invalid source sha256/,
  );
});

// ---- 2. mustQuoteCell truth table ----------------------------------------

test('mustQuoteCell truth table covers every gcfc rule class', () => {
  const must = [
    '',                              // empty
    '-', '~', '^', 'true', 'false',  // sentinels / booleans
    '^{a}',                          // canonical-ref literal
    '0', '12', '42', '-12.5', '1e10', '1E+3',// strict JSON numbers (incl leading -)
    '01', '+3', '.5',                // numeric-like
    '#tag', '@user', '.dot',         // leading sigil
    ' lead', 'trail ', '\tin', 'out\n', '\rcr', // leading/trailing ASCII ws
    'a|b', 'a,b',                    // delimiters
    'line\nbreak',                   // control
    'ctrl\u0000', 'ctrl\u001f',      // controls
    'c1\u0080', 'c1\u009f',          // C1
    'say "hi"', 'back\\slash',       // quote / backslash
    'nb\u00a0sp', '\u2003em', '\u3000ideo', 'bom\ufeff', // exotic spaces
    'ERR[404]: Not Found',           // inline-array pattern
  ];
  for (const s of must) assert.equal(mustQuoteCell(s), true, `expected QUOTE for ${JSON.stringify(s)}`);

  const bare = [
    'hello world', '123abc', 'Привет', '😀',
    'messages', 'y2025m08', '2025-08-26T11:30:39',
    'a-b', 'foo.bar', 'foo/bar', 'x[1]', 'plain',
  ];
  for (const s of bare) assert.equal(mustQuoteCell(s), false, `expected BARE for ${JSON.stringify(s)}`);
});

test('quoted() matches gcfc canonical escaping (lowercase \\uXXXX)', () => {
  assert.equal(quoted(''), '""');
  assert.equal(quoted('a|b'), '"a|b"');
  assert.equal(quoted('say "hi"'), '"say \\"hi\\""');
  assert.equal(quoted('a\\b'), '"a\\\\b"');
  assert.equal(quoted('\n\t\r\b\f'), '"\\n\\t\\r\\b\\f"');
  assert.equal(quoted('\u0001'), '"\\u0001"');
  assert.equal(quoted('\u001f'), '"\\u001f"');
  assert.equal(quoted('Привет'), '"Привет"'); // non-ASCII emitted literally
});

// ---- 3. byte-offset precision --------------------------------------------

test('emitted offsets equal synthetic .gcf byte ground truth', () => {
  const enc = new TextEncoder();
  const chunks = [];
  let len = 0;
  const add = (s) => { const b = enc.encode(s); chunks.push(b); len += b.length; };

  add('GCF profile=generic\n');          // 21 bytes
  add('p'.repeat(810 - len));            // pad to byte 810
  const headerOffset = len;              // == 810
  add('## messages [3]{m,p,t,r,txt}\n'); // 29 bytes -> 839
  add('p'.repeat(860 - len));            // pad to byte 860
  const row0Offset = len;                // == 860
  add('0|P0|1756197039|~|hello\n');
  add('1|P0|1756197040|~|world\n');
  add('2|P0|1756197041|~|bye\n');

  const buf = new Uint8Array(len);
  let p = 0;
  for (const b of chunks) { buf.set(b, p); p += b.length; }

  const indexOfBytes = (needle) => {
    const n = enc.encode(needle);
    outer: for (let i = 0; i + n.length <= buf.length; i++) {
      for (let j = 0; j < n.length; j++) if (buf[i + j] !== n[j]) continue outer;
      return i;
    }
    return -1;
  };

  assert.equal(headerOffset, 810);
  assert.equal(row0Offset, 860);
  const gtHeader = indexOfBytes('## messages [3]');
  const gtRow0 = indexOfBytes('0|P0|1756197039');
  assert.equal(gtHeader, 810);
  assert.equal(gtRow0, 860);

  const text = emitIndex({
    stride: 64,
    sections: [{ name: 'messages', first: 0, count: 3, offset: gtHeader, t0: 1756197039, t1: 1756197041 }],
    anchors: [{ m: 0, offset: gtRow0, t: 1756197039 }],
  });

  const parsed = parseIndex(text);
  assert.equal(parsed.sections[0].offset, gtHeader);
  assert.equal(parsed.anchors[0].offset, gtRow0);
  // Byte-for-byte emission, not just parse symmetry.
  assert.match(text, /^messages\|0\|3\|810\|1756197039\|1756197041$/m);
  assert.match(text, /^0\|860\|1756197039$/m);
});

// ---- 4. packRoot determinism ---------------------------------------------

test('packRoot is order-independent and value-sensitive', async () => {
  const rows = [];
  for (let i = 0; i < 64; i++) {
    rows.push({ m: i, tg: 1000 + i, off: i * 10, len: i, date: '2025-08-26T11:30:39' });
  }
  const shuffled = [...rows].reverse();
  const a = await packRoot(rows);
  const b = await packRoot(shuffled);
  assert.equal(a, b);
  assert.match(a, /^sha256:[0-9a-f]{64}$/);

  const changed = rows.map((r, i) => (i === 10 ? { ...r, len: r.len + 1 } : r));
  const c = await packRoot(changed);
  assert.notEqual(a, c);
});

test('compareBytes sorts by unsigned UTF-8 byte order', () => {
  const enc = new TextEncoder();
  const bytes = ['я', 'a', 'z', '|', '0', 'A'].map((s) => enc.encode(s));
  const sorted = [...bytes].sort(compareBytes).map((u) => new TextDecoder().decode(u));
  // ASCII sorts before multi-byte Cyrillic; uppercase before lowercase.
  assert.deepEqual(sorted, ['0', 'A', 'a', 'z', '|', 'я']);
});

// ---- 5. cross-implementation conformance with B's artifacts ---------------
// Reference artifacts live outside this repo (personal data); tests skip when
// absent. Point GCF_REF_DIR at a directory holding result.{idx,map}.gcf.
const B = process.env.GCF_REF_DIR ?? '/Users/viktor/Downloads/kristina maskot/embed';
const HAVE_B = fs.existsSync(B + '/result.idx.gcf') && fs.existsSync(B + '/result.map.gcf');

test('parseIndex reads B gcfc real result.idx.gcf', (t) => {
  if (!HAVE_B) return t.skip(`reference artifacts not present: ${B}`);
  const idx = parseIndex(fs.readFileSync(B + '/result.idx.gcf', 'utf8'));
  assert.equal(idx.stride, 64);
  assert.deepEqual(idx.sections[0], { name: 'messages', first: 0, count: 20400, offset: 810, t0: 1756197039, t1: 1759265407 });
  assert.deepEqual(idx.anchors[0], { m: 0, offset: 860, t: 1756197039 });
  assert.equal(idx.anchors.length, 319);
});

test('parseMap reads B gcfc real result.map.gcf', (t) => {
  if (!HAVE_B) return t.skip(`reference artifacts not present: ${B}`);
  const map = parseMap(fs.readFileSync(B + '/result.map.gcf', 'utf8'));
  assert.equal(map.source.sha256, 'b23c6f07041ee657579414a0371f374d724e356dcb91411b1164b310f00e16e2');
  assert.equal(map.source.file, 'result.json');
  assert.equal(map.rows.length, 20400);
  assert.deepEqual(map.rows[0], { m: 0, tg: 1293862, off: 106, len: 940, date: '2025-08-26T11:30:39' });
});
