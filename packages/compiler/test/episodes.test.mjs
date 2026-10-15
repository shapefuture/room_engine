import test from 'node:test';
import assert from 'node:assert/strict';
import {tokens} from '../../../packages/shared/src/tokens.mjs';
import {makeEpisodes,makeEpisode,computeBoundaries} from '../src/episodes.mjs';

// Canonical message shape: {seq,p,t,r,text,salience,...} (salience precomputed by caller).
const mk=(seq,t,text,extra={})=>({seq,p:extra.p??0,t,r:extra.r??null,text,salience:extra.salience??0.1});

test('compat: preserves the Episode shape and gap segmentation',()=>{
  const msgs=[mk(0,100,'hello there chaos'),mk(1,102,'chaos wow'),mk(2,50000,'new topic chaos'),mk(3,50010,'chaos again'),mk(4,50020,'same chaos again')];
  const eps=makeEpisodes(msgs,tokens);
  assert.equal(eps.length,2);
  assert.equal(eps[0].message_ids.length,2);
  assert.deepEqual(eps.map(e=>e.id),['E0000','E0001']);
  assert.deepEqual(eps[0].message_ids,[0,1]);
  assert.equal(eps[0].status,'DERIVED');
  assert.equal(eps[0].start,100);
  assert.equal(eps[0].end,102);
  assert.deepEqual(eps[0].participants,[0]);
  assert.match(eps[0].summary,/^2 messages across \d+ min; themes: /);
  assert.ok(Array.isArray(eps[0].representative)&&eps[0].representative.length<=5);
  assert.ok(eps[0].themes.length>0);
  // summary template for the multi-message case; single-message case is the raw text.
  const single=makeEpisode([mk(0,100,'lone message here')],0);
  assert.equal(single.summary,'lone message here');
});

test('cohesion: pass 2 splits a long burst at a topic switch',()=>{
  const A='alpha beta gamma delta epsilon';
  const B='orion vega sirius polaris altair';
  const msgs=[];
  for(let i=0;i<120;i++)msgs.push(mk(i,1000+i*10,i<60?A:B));
  // Uniform 10s gaps are below SOFT_GAP, so pass 1 must not cut at all.
  assert.deepEqual(computeBoundaries(msgs,tokens),[0,120],'pass 1 must not cut when gaps < SOFT_GAP');
  const eps=makeEpisodes(msgs,tokens);
  assert.ok(eps.length>=2,`pass 2 should split the burst, got ${eps.length} episode(s)`);
  assert.equal(eps[0].message_ids.length,60);
  assert.equal(eps[1].message_ids.length,60);
});

test('reply stickiness: recent replies suppress soft-gap cuts',()=>{
  const msgs=[];
  for(let i=0;i<100;i++)msgs.push(mk(i,1000+i*1500,`topic words around number ${i}`,{r:i===0?null:Math.max(0,i-5)}));
  // 1500s is a medium gap (>=SOFT, <HARD); every message replies within 5 back.
  assert.deepEqual(computeBoundaries(msgs,tokens),[0,100],'soft-gap branch must yield no boundaries');
});

test('salience passthrough: representative is top-5 by salience',()=>{
  const msgs=[];
  for(let i=0;i<6;i++)msgs.push(mk(i,1000+i,`message number ${i}`,{salience:Number((0.1*(i+1)).toFixed(2))}));
  const ep=makeEpisode(msgs,0);
  assert.deepEqual(ep.representative,[5,4,3,2,1]);
  assert.equal(ep.id,'E0000');
});

test('perf: 5,000 messages segment under 2s',()=>{
  const vocab=[];
  for(let i=0;i<100;i++)vocab.push(`word${String(i).padStart(3,'0')}`);
  const msgs=[];
  for(let i=0;i<5000;i++){
    const a=vocab[i%vocab.length],b=vocab[(i*7)%vocab.length],c=vocab[(i*13)%vocab.length];
    msgs.push(mk(i,1000+i*60,`${a} ${b} ${c} topic turn`));
  }
  const start=performance.now();
  const eps=makeEpisodes(msgs,tokens);
  const ms=performance.now()-start;
  assert.ok(eps.length>=1);
  assert.ok(ms<2000,`segmentation took ${ms.toFixed(0)}ms`);
});
