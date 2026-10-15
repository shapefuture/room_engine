import test from 'node:test';
import assert from 'node:assert/strict';
import {Background,GENERIC_RANK,DP_FLOOR,DF_CEILING} from '../src/background.mjs';

// Ground truth: B's /Users/viktor/Downloads/kristina maskot/embed/room-of-us/
// compiler/src/background.py (class Background). Values below were confirmed by
// executing that module once during L1a.

const SMALL=[['cat','cat','cat','dog'],['cat','cat'],['quantum','cat']];

test('empty corpus does not throw and reports zero dispersion',()=>{
  const bg=new Background([[]]);
  assert.doesNotThrow(()=>new Background([]));
  assert.equal(bg.dp('x'),0);
  assert.equal(bg.isGeneric('x'),true);   // total<3 -> generic
  assert.equal(bg.specificity('x'),0);    // total<2 guard, matches B
});

test('dp stays within [0,1] and rarity/rank ordering holds',()=>{
  const bg=new Background(SMALL);
  for(const w of ['cat','dog','quantum'])assert.ok(bg.dp(w)>=0&&bg.dp(w)<=1,`dp(${w})`);
  // rank desc by frequency; rare words are more "rare"
  assert.ok(bg.rankOf('cat')<bg.rankOf('quantum'));
  assert.ok(bg.rarity('quantum')>bg.rarity('cat'));
});

test('cat is generic in the 3-episode corpus',()=>{
  const bg=new Background(SMALL);
  assert.equal(bg.isGeneric('cat'),true); // rank 0 < GENERIC_RANK
});

test('quantum is NOT generic in a corpus with a large vocabulary',()=>{
  // MERGE_PLAN §2.2 claims isGeneric('quantum')===false on the tiny 3-episode
  // corpus — that is impossible: with <700 vocab every word with total>=3 hits
  // the rank<700 branch, and quantum has total=1 (<3) which is generic by the
  // total<3 guard. B's algorithm and this port both return TRUE there.
  // To exercise the real "bursty specific word" path we need vocab>700 so the
  // word falls below the generic rank band with high dispersion + low df.
  const EP=12,F=720,corpus=[];
  for(let i=0;i<EP;i++){
    const toks=['cat','cat'];
    for(let j=0;j<F;j++)toks.push(`f${String(j).padStart(3,'0')}`);
    if(i===0)for(let k=0;k<4;k++)toks.push('quantum');
    corpus.push(toks);
  }
  const bg=new Background(corpus);
  assert.ok(bg.vocab>GENERIC_RANK);
  assert.equal(bg.isGeneric('cat'),true);
  assert.equal(bg.isGeneric('quantum'),false);
  assert.ok(bg.dp('quantum')>DP_FLOOR);
  assert.ok(bg.dfFrac('quantum')<DF_CEILING);
  assert.ok(bg.specificity('quantum')>bg.specificity('cat'));
});

test('matches B ground-truth values on the 3-episode corpus',()=>{
  const bg=new Background(SMALL);
  assert.equal(bg.vocab,3);
  assert.equal(bg.nEp,3);
  assert.equal(bg.rankOf('cat'),0);
  assert.equal(bg.rankOf('quantum'),2);
  assert.ok(Math.abs(bg.dp('cat')-0.08333333333333333)<1e-12);
  assert.ok(Math.abs(bg.dp('quantum')-0.75)<1e-12);
  assert.ok(Math.abs(bg.specificity('cat')-0.05675571268077996)<1e-12);
  assert.equal(bg.specificity('quantum'),0); // total<2 guard
});
