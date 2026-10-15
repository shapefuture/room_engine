import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {compileTelegram} from '../../compiler/src/compile.mjs';
import {encodeCanonicalMessages} from '../src/gcf.mjs';
import {buildShards, bootCartridge, verifyCartridge} from '../src/runtime-core.mjs';

// ---- fixture ---------------------------------------------------------------
// Synthetic two-participant chat with spans, links, reactions and temporal gaps
// so compileTelegram emits a real cartridge (discoveries + episodes) that the
// three integrity manifests cover.
const raw = {
  name: 'Shard Chat',
  type: 'personal_chat',
  id: 42,
  messages: [
    {id: 1, date_unixtime: '1756000000', from: 'Viktor', from_id: 'u1', text: 'hello there? chaos'},
    {id: 2, date_unixtime: '1756000030', from: 'Friend', from_id: 'u2', reply_to_message_id: 1, text: [{type: 'bold', text: 'chaos wow'}], text_entities: [{type: 'bold', text: 'chaos wow'}]},
    {id: 3, date_unixtime: '1756000060', from: 'Viktor', from_id: 'u1', text: 'look at https://example.com/x chaos'},
    {id: 4, date_unixtime: '1756000090', from: 'Friend', from_id: 'u2', text: 'chaos again', reactions: [{type: 'emoji', emoji: '😂', count: 2}]},
    {id: 5, date_unixtime: '1756000120', from: 'Viktor', from_id: 'u1', text: 'same chaos again?'},
    {id: 6, date_unixtime: '1756000150', from: 'Friend', from_id: 'u2', text: 'blueberry pancakes'},
    {id: 7, date_unixtime: '1756100000', from: 'Viktor', from_id: 'u1', text: 'new topic chaos museum'},
    {id: 8, date_unixtime: '1756100030', from: 'Friend', from_id: 'u2', text: 'museum chaos again'},
    {id: 9, date_unixtime: '1756100060', from: 'Viktor', from_id: 'u1', text: 'chaos memories'},
    {id: 10, date_unixtime: '1756100090', from: 'Friend', from_id: 'u2', text: 'chaos memories again?'},
    {id: 11, date_unixtime: '1756200000', from: 'Viktor', from_id: 'u1', text: 'chaos lore'},
    {id: 12, date_unixtime: '1756200030', from: 'Friend', from_id: 'u2', text: 'chaos lore forever'},
    {id: 13, date_unixtime: '1756200060', from: 'Viktor', from_id: 'u1', text: 'chaos and more chaos? https://other.org/y'},
    {id: 14, date_unixtime: '1756200090', from: 'Friend', from_id: 'u2', text: 'yes chaos'},
  ],
};

const {cartridge} = await compileTelegram(raw, {roles: {Viktor: 'HIM', Friend: 'HER'}});

// ---- fetch shim ------------------------------------------------------------
function shim(files) {
  return async (url) => {
    const entry = files.get(url);
    if (!entry) return {ok: false, status: 404, json: async () => { throw new Error('404'); }, text: async () => ''};
    return {ok: entry.status >= 200 && entry.status < 300, status: entry.status, json: async () => JSON.parse(entry.body), text: async () => entry.body};
  };
}

function filesFrom(core, shards) {
  const files = new Map();
  files.set('/cartridge-parts/core.json', {status: 200, body: JSON.stringify(core)});
  for (const s of shards) files.set(`/cartridge-parts/${s.file}`, {status: 200, body: s.text});
  return files;
}

// ---- 1. roundtrip ----------------------------------------------------------

test('sharded boot reassembles the monolith and passes verifyCartridge', async () => {
  const {core, shards} = await buildShards(cartridge, 5);
  assert.ok(shards.length > 1, 'expected multiple shards');
  assert.equal(core.tier1.messages.length, 0);
  assert.equal(core.provenance.messages.length, 0);
  assert.equal(core.integrity.sharded, true);
  assert.equal(core.integrity.shards.length, shards.length);

  const booted = await bootCartridge(shim(filesFrom(core, shards)));
  await verifyCartridge(booted);
  assert.deepEqual(booted.tier1.messages, cartridge.tier1.messages);
  assert.deepEqual(booted.provenance.messages, cartridge.provenance.messages);
  assert.equal('sharded' in booted.integrity, false);
  assert.equal('shards' in booted.integrity, false);
});

// ---- 2. corrupt shard ------------------------------------------------------

test('corrupt shard text is rejected with the shard file in the error', async () => {
  const {core, shards} = await buildShards(cartridge, 5);
  const tampered = shards.map((s, i) => {
    if (i !== 1) return s;
    const obj = JSON.parse(s.text);
    obj.messages[0].text = obj.messages[0].text + ' X';
    return {...s, text: JSON.stringify(obj)};
  });
  await assert.rejects(() => bootCartridge(shim(filesFrom(core, tampered))), /shard integrity failed: messages-001\.json|integrity/);
});

// ---- 3. missing shard ------------------------------------------------------

test('missing shard file surfaces the HTTP status', async () => {
  const {core, shards} = await buildShards(cartridge, 5);
  const files = filesFrom(core, shards);
  files.delete(`/cartridge-parts/${shards[2].file}`);
  await assert.rejects(() => bootCartridge(shim(files)), /HTTP 404/);
});

// ---- 4. non-contiguous shard table -----------------------------------------

test('non-contiguous shard table is rejected', async () => {
  const {core, shards} = await buildShards(cartridge, 5);
  const bad = structuredClone(core);
  const t = bad.integrity.shards;
  [t[1], t[2]] = [t[2], t[1]];
  await assert.rejects(() => bootCartridge(shim(filesFrom(bad, shards))), /contiguity/);
});

// ---- 5. tampered shard with recomputed sha256 ------------------------------

test('tampered shard with matching rehashed sha256 fails manifest verification', async () => {
  const {core, shards} = await buildShards(cartridge, 5);
  const obj = JSON.parse(shards[0].text);
  obj.messages[0].text = obj.messages[0].text + ' tampered';
  const newText = JSON.stringify(obj);
  const newSha = crypto.createHash('sha256').update(newText, 'utf8').digest('hex');
  const bad = structuredClone(core);
  bad.integrity.shards[0].sha256 = newSha;
  bad.integrity.shards[0].bytes = Buffer.byteLength(newText, 'utf8');
  const newShards = shards.map((s, i) => (i === 0 ? {file: s.file, text: newText} : s));
  await assert.rejects(() => bootCartridge(shim(filesFrom(bad, newShards))), /cartridge integrity verification failed/);
});

// ---- 6. legacy monolith fallback -------------------------------------------

test('legacy monolith fallback boots when core.json is absent', async () => {
  const files = new Map();
  files.set('/cartridge.json', {status: 200, body: JSON.stringify(cartridge)});
  files.set('/cartridge.gcf', {status: 200, body: encodeCanonicalMessages(cartridge.tier1.messages)});
  const phases = [];
  const booted = await bootCartridge(shim(files), (p) => phases.push(p.phase));
  await verifyCartridge(booted);
  assert.equal(booted.chat.message_count, cartridge.chat.message_count);
  assert.deepEqual(phases, ['monolith']);
});

// ---- 7. progress callback --------------------------------------------------

test('onProgress reports shard progress through to completion', async () => {
  const {core, shards} = await buildShards(cartridge, 5);
  const calls = [];
  await bootCartridge(shim(filesFrom(core, shards)), (p) => calls.push(p));
  const shardCalls = calls.filter((c) => c.phase === 'shards');
  assert.equal(shardCalls.length, shards.length);
  assert.equal(shardCalls.at(-1).done, shards.length);
  assert.equal(shardCalls.at(-1).total, shards.length);
});
