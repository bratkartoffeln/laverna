import { mkdir, writeFile, rm } from 'node:fs/promises';
import { Updater } from './core.mjs';
import { setTimeout as delay } from 'node:timers/promises';
const updater=new Updater({dryRun:process.argv.includes('--dry-run'),log:message=>console.log(new Date().toISOString()+' '+message)});
await mkdir(updater.stateRoot,{recursive:true,mode:0o700});
// This directory belongs to the single updater container. A restart releases
// its process lock; activation recovery uses a separate durable journal.
await rm(updater.stateRoot+'/lock',{recursive:true,force:true});
// Readiness measures scheduler liveness. Its first legitimate image build can
// exceed the container startup grace period on a NAS.
await writeFile(updater.stateRoot+'/heartbeat',String(Date.now()));
let stopping=false;const controller=new AbortController();
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{stopping=true;controller.abort();});
do {
  try{await updater.poll();}
  catch(e){console.error(new Date().toISOString()+' '+e.message);}
  await writeFile(updater.stateRoot+'/heartbeat',String(Date.now()));
  if(process.argv.includes('--once')||stopping)break;
  await delay(300000,undefined,{signal:controller.signal}).catch(()=>{});
}while(!stopping);
