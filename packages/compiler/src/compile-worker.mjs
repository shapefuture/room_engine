import {parentPort} from 'node:worker_threads';
import {transformMessage} from './compile.mjs';
import {tokens} from '../../shared/src/tokens.mjs';

// Parallel compile worker (M7): receives one raw-message slice, returns the
// transformed canonical rows (x + provenance + tokens) so the main thread can
// assemble them in order. Byte-identical results to the sequential path.
parentPort.on('message',({slice,pmapEntries,startSeq})=>{
  const pmap=new Map(pmapEntries);const p=id=>pmap.get(String(id??'unknown'))??0;
  const rows=slice.map((m,i)=>{const {x,prov}=transformMessage(m,startSeq+i,p(m.from_id??m.from));return {x,prov,toks:tokens(x.text)};});
  parentPort.postMessage(rows);
});
