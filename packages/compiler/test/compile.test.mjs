import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {compileTelegram} from '../src/compile.mjs';
import {verifyCartridge} from '../../../packages/shared/src/runtime-core.mjs';

const sample={name:'Test',type:'personal_chat',id:1,messages:[
 {id:1,date_unixtime:'100',from:'A',from_id:'a',text:'hello there? chaos'} ,
 {id:2,date_unixtime:'102',from:'B',from_id:'b',reply_to_message_id:1,text:[{type:'bold',text:'chaos wow'}],text_entities:[{type:'bold',text:'chaos wow'}],reactions:[{type:'emoji',emoji:'❤',count:1}]},
 {id:3,date_unixtime:'50000',from:'A',from_id:'a',text:'new topic https://example.com chaos'} ,
 {id:4,date_unixtime:'50010',from:'B',from_id:'b',text:'chaos again'} ,
 {id:5,date_unixtime:'50020',from:'A',from_id:'a',text:'same chaos again'}
]};

test('normalizes participants and dense IDs',async ()=>{const r=await compileTelegram(sample);assert.equal(r.canonical[0].seq,0);assert.equal(r.canonical[0].p,0);assert.equal(r.canonical[1].p,1);assert.equal(r.cartridge.tier0.discoveries.every(d=>d.evidence.length>0),true);});
test('preserves reply provenance and strips raw URL from model text',async ()=>{const r=await compileTelegram(sample);assert.equal(r.canonical[1].r,0);assert.match(r.canonical[2].text,/\[link\]/);assert.equal(r.cartridge.provenance.messages[0]?.seq,0);assert.equal('_telegram_id' in r.cartridge.tier1.messages[0],false);});
test('segments temporal episodes',async ()=>{const r=await compileTelegram(sample);assert.equal(r.episodes.length,2);assert.equal(r.episodes[0].message_ids.length,2);});
test('builds deterministic search and semantic indexes',async ()=>{const a=await compileTelegram(sample),b=await compileTelegram(sample);assert.deepEqual(a.cartridge.tier1.search.index,b.cartridge.tier1.search.index);assert.ok(a.cartridge.tier1.search.semantic.discovery_hits);assert.ok(Array.isArray(a.cartridge.tier1.search.sample));});
test('emits relational candidate classes without LLM runtime',async ()=>{const r=await compileTelegram(sample);const types=new Set(r.cartridge.tier0.discoveries.map(d=>d.type));assert.ok(types.has('relationship'));assert.ok(types.has('emergence'));assert.ok(r.cartridge.tier0.third_mind.some(d=>d.type==='emergence'));});

test('does not manufacture Third Mind emergence without cross-voice semantic overlap',async ()=>{
  const raw={name:'No Shared',type:'personal_chat',id:2,messages:[
    {id:1,date_unixtime:'100',from:'A',from_id:'a',text:'quantum mechanics?'} ,
    {id:2,date_unixtime:'101',from:'B',from_id:'b',text:'blueberry pancakes'} ,
    {id:3,date_unixtime:'102',from:'A',from_id:'a',text:'Schrödinger'} ,
    {id:4,date_unixtime:'103',from:'B',from_id:'b',text:'mountain bicycles'}
  ]};
  const r=await compileTelegram(raw);
  assert.equal(r.cartridge.tier0.discoveries.some(d=>d.type==='emergence'),false);
  assert.equal(r.cartridge.tier0.third_mind.length,0);
});

test('content manifest detects semantic-payload tampering',async ()=>{
  const r=await compileTelegram(sample);
  const c=structuredClone(r.cartridge);
  const original=c.integrity.content_manifest;
  c.tier0.discoveries[0].title='tampered';
  assert.notEqual(original, crypto.createHash('sha256').update(JSON.stringify((()=>{const x=structuredClone(c);delete x.integrity;return x;})())).digest('hex'));
});

test('rich span offsets align with normalized message text',async ()=>{
  const r=await compileTelegram(sample);
  const m=r.canonical[1];
  assert.equal(m.text,'chaos wow');
  assert.ok(Array.isArray(m.spans)&&m.spans.length===1);
  const [start,end,kind,href]=m.spans[0];
  assert.equal(m.text.slice(start,end),'chaos wow');
  assert.equal(kind,'bold');
  assert.equal(href,null);
});

test('plain-text URLs produce link metadata and [link] normalization',async ()=>{
  const raw={name:'Links',type:'personal_chat',id:3,messages:[
    {id:1,date_unixtime:'100',from:'A',from_id:'a',text:'see https://www.example.com/x and https://other.org/y'}
  ]};
  const r=await compileTelegram(raw);
  assert.match(r.canonical[0].text,/\[link\]/);
  const hosts=r.canonical[0].links.map(l=>l.host).sort();
  assert.deepEqual(hosts,['example.com','other.org']);
});

test('archives exceeding the discovery cap still satisfy their own integrity manifest',async()=>{
  const words=['chaos','lore','pancakes','quantum','museum','rabbit','universe','telescope','atlas','mirror','oracle','archive','memory','joke','question','dream','music','coffee','train','winter'];
  const messages=[];
  for(let i=0;i<600;i++){
    const w1=words[i%words.length], w2=words[(i*7)%words.length];
    messages.push({id:i+1,date_unixtime:String(1756000000+i*(i%80===79?20000:30)),from:i%2?'Friend':'Viktor',from_id:i%2?'u2':'u1',
      text: i%2? `${w1} ${w2}? tell me about ${w1} again ${w2}` : `haha ${w1} ${w2} lol that ${w2} story`,
      reactions: i%5===0&&!(i%2)?[{type:'emoji',emoji:'😂',count:2}]:undefined});
  }
  const {cartridge}=await compileTelegram({name:'Large',type:'personal_chat',id:9,messages});
  assert.equal(cartridge.tier0.discoveries.length,36);
  // The cap must hold a diverse mix: a single class filling all slots would
  // lock the Semantic Door (it requires >=2 pattern classes incl. cross-voice).
  assert.ok(new Set(cartridge.tier0.discoveries.map(d=>d.type)).size>=2,'discovery cap lacks class diversity');
  assert.equal(cartridge.integrity.evidence_records,new Set(cartridge.tier0.discoveries.flatMap(d=>d.evidence)).size);
  const discIds=new Set(cartridge.tier0.discoveries.map(d=>d.id));
  assert.ok(cartridge.tier0.third_mind.every(d=>discIds.has(d.id)));
  await verifyCartridge(cartridge);
});
