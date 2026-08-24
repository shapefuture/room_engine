import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {compileTelegram} from '../src/compile.mjs';

const sample={name:'Test',type:'personal_chat',id:1,messages:[
 {id:1,date_unixtime:'100',from:'A',from_id:'a',text:'hello there? chaos'} ,
 {id:2,date_unixtime:'102',from:'B',from_id:'b',reply_to_message_id:1,text:[{type:'bold',text:'chaos wow'}],text_entities:[{type:'bold',text:'chaos wow'}],reactions:[{type:'emoji',emoji:'❤',count:1}]},
 {id:3,date_unixtime:'50000',from:'A',from_id:'a',text:'new topic https://example.com chaos'} ,
 {id:4,date_unixtime:'50010',from:'B',from_id:'b',text:'chaos again'} ,
 {id:5,date_unixtime:'50020',from:'A',from_id:'a',text:'same chaos again'}
]};

test('normalizes participants and dense IDs',()=>{const r=compileTelegram(sample);assert.equal(r.canonical[0].seq,0);assert.equal(r.canonical[0].p,0);assert.equal(r.canonical[1].p,1);assert.equal(r.cartridge.tier0.discoveries.every(d=>d.evidence.length>0),true);});
test('preserves reply provenance and strips raw URL from model text',()=>{const r=compileTelegram(sample);assert.equal(r.canonical[1].r,0);assert.match(r.canonical[2].text,/\[link\]/);assert.equal(r.cartridge.provenance.messages[0]?.seq,0);assert.equal('_telegram_id' in r.cartridge.tier1.messages[0],false);});
test('segments temporal episodes',()=>{const r=compileTelegram(sample);assert.equal(r.episodes.length,2);assert.equal(r.episodes[0].message_ids.length,2);});
test('builds deterministic search and semantic indexes',()=>{const a=compileTelegram(sample),b=compileTelegram(sample);assert.deepEqual(a.cartridge.tier1.search.index,b.cartridge.tier1.search.index);assert.ok(a.cartridge.tier1.search.semantic.discovery_hits);assert.ok(Array.isArray(a.cartridge.tier1.search.sample));});
test('emits relational candidate classes without LLM runtime',()=>{const r=compileTelegram(sample);const types=new Set(r.cartridge.tier0.discoveries.map(d=>d.type));assert.ok(types.has('relationship'));assert.ok(types.has('emergence'));assert.ok(r.cartridge.tier0.third_mind.some(d=>d.type==='emergence'));});

test('does not manufacture Third Mind emergence without cross-voice semantic overlap',()=>{
  const raw={name:'No Shared',type:'personal_chat',id:2,messages:[
    {id:1,date_unixtime:'100',from:'A',from_id:'a',text:'quantum mechanics?'} ,
    {id:2,date_unixtime:'101',from:'B',from_id:'b',text:'blueberry pancakes'} ,
    {id:3,date_unixtime:'102',from:'A',from_id:'a',text:'Schrödinger'} ,
    {id:4,date_unixtime:'103',from:'B',from_id:'b',text:'mountain bicycles'}
  ]};
  const r=compileTelegram(raw);
  assert.equal(r.cartridge.tier0.discoveries.some(d=>d.type==='emergence'),false);
  assert.equal(r.cartridge.tier0.third_mind.length,0);
});

test('content manifest detects semantic-payload tampering',()=>{
  const r=compileTelegram(sample);
  const c=structuredClone(r.cartridge);
  const original=c.integrity.content_manifest;
  c.tier0.discoveries[0].title='tampered';
  assert.notEqual(original, crypto.createHash('sha256').update(JSON.stringify((()=>{const x=structuredClone(c);delete x.integrity;return x;})())).digest('hex'));
});
