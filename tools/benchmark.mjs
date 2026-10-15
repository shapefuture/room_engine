import fs from 'node:fs';
import { compileTelegram } from '../packages/compiler/src/compile.mjs';
const n=Number(process.argv[2]||20000);
const messages=[];
for(let i=0;i<n;i++) messages.push({id:i+1,date_unixtime:String(1756000000+i*17),from:i%2?'Friend':'Viktor',from_id:i%2?'u2':'u1',text:i%97===0?`Question ${i}? This should become lore #topic${i%13}`:`message ${i} with ordinary conversational content`});
const input={name:'Benchmark',type:'personal_chat',id:7,messages};
const before=process.memoryUsage().rss; const t=performance.now(); const result=await compileTelegram(input); const ms=performance.now()-t; const after=process.memoryUsage().rss;
const cartridge=JSON.stringify(result.cartridge);
console.log(JSON.stringify({messages:n,episodes:result.episodes.length,ms:Number(ms.toFixed(2)),messages_per_sec:Math.round(n/(ms/1000)),rss_mb_before:Number((before/1048576).toFixed(1)),rss_mb_after:Number((after/1048576).toFixed(1)),cartridge_kb:Number((Buffer.byteLength(cartridge)/1024).toFixed(1))},null,2));
