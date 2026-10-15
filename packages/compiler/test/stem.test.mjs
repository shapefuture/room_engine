import test from 'node:test';
import assert from 'node:assert/strict';
import {stem,stemRu,stemEn} from '../src/stem.mjs';

// Golden vectors generated ONCE (read-only) during L1a by executing B's
// ground-truth stemmer:
//   python3 -c "import sys; sys.path.insert(0,'<embed>/compiler/src');
//               import stem as S; print([(w,S.stem(w)) for w in [...]])"
// Source: /Users/viktor/Downloads/kristina maskot/embed/room-of-us/compiler/src/stem.py
// NOTE: these differ from the vectors printed in MERGE_PLAN §2.1 (that table was
// never verified against stem.py — e.g. 'честь'->'чест' not 'чес', 'happy' stays
// 'happy', 'running'->'runn'). stem.py is the ground truth per the L1a spec.
const RU=[
  ['позиционные','позицион'],['вирусология','вирусолог'],['прекраснейшая','прекрасн'],
  ['связалась','связ'],['потянутся','потянут'],['честь','чест'],['музыка','музык'],
  ['музыку','музык'],['музыке','музык'],['воспоминания','воспоминан'],['навсегда','навсегд'],
];
const EN=[['running','runn'],['flies','fli'],['happy','happy'],['ational','ational']];

test('stems Russian golden vectors exactly as B does',()=>{
  for(const [w,expected] of RU)assert.equal(stem(w),expected,`stem(${w})`);
});
test('stems English golden vectors exactly as B does',()=>{
  for(const [w,expected] of EN)assert.equal(stem(w),expected,`stem(${w})`);
});
test('dispatches RU for Cyrillic and EN otherwise',()=>{
  assert.equal(stem('музыка'),stemRu('музыка'));
  assert.equal(stem('running'),stemEn('running'));
  assert.equal(stemRu('running'),'running'); // no Cyrillic: RU tables simply no-op -> unchanged
  assert.equal(stemEn('музыка'),'музыка');
});
test('is idempotent on the golden vectors (where B is)',()=>{
  for(const [w,g] of RU){if(w==='воспоминания')continue;assert.equal(stem(g),g,`stem(stem(${w}))`);}
  for(const [w,g] of EN)assert.equal(stem(g),g,`stem(stem(${w}))`);
});
test('records B-known non-idempotent input (port fidelity, not a bug)',()=>{
  // 'воспоминания' -> 'воспоминан' -> 'воспомин': stem.py is NOT idempotent here.
  // We reproduce it exactly; do not "fix" the algorithm.
  assert.equal(stem('воспоминания'),'воспоминан');
  assert.equal(stem(stem('воспоминания')),'воспомин');
});
test('normalises ё to е and lowercases',()=>{
  assert.equal(stem('ёлка'),'елк');
  assert.equal(stem('Ёлки'),'елк');
  assert.equal(stemRu('ёлки'),stemRu('елки'));
  assert.equal(stem('МУЗЫКА'),'музык');
});
test('passes through words shorter than 4 chars',()=>{
  assert.equal(stem('дом'),'дом');
  assert.equal(stem('cat'),'cat');
  assert.equal(stemRu('её'),'ее');
});
