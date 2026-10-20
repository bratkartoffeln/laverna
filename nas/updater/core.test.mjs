import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Updater, verifiedRun, archivePathsOK, validSHA, atomicJSON, REPOSITORY, BRANCH, PROJECT } from './core.mjs';
test('Only newest successful push CI on the exact master SHA enables rollout',()=>{
  const sha='a'.repeat(40),good={id:1,head_sha:sha,head_branch:'master',event:'push',status:'completed',conclusion:'success'};
  assert.equal(verifiedRun([good],sha),true);
  for(const different of [{head_sha:'b'.repeat(40)},{head_branch:'other'},{event:'pull_request'},{status:'in_progress'},{conclusion:'failure'}])assert.equal(verifiedRun([{...good,...different}],sha),false);
  assert.equal(verifiedRun([good,{...good,id:2,status:'in_progress'}],sha),false);
  assert.equal(REPOSITORY,'bratkartoffeln/laverna');assert.equal(BRANCH,'master');assert.equal(PROJECT,'laverna');assert.equal(validSHA('../rps'),false);
});
test('Source archives reject traversal, mixed roots, links and special entries',()=>{
  assert.equal(archivePathsOK('root/\nroot/file.js\n','drwx root/\n-rwx root/file.js\n'),true);
  for(const names of ['','/root/a\n','root/../a\n','root/./a\n','root/a\nother/b\n','root/..\\a\n'])assert.equal(archivePathsOK(names,'-rw a\n'),false);
  for(const type of ['l','h','b','c','p'])assert.equal(archivePathsOK('root/file\n',type+'rwx file\n'),false);
});
async function fixture(t,failAt) {
  const base=await mkdtemp(join(tmpdir(),'laverna-updater-'));t.after(()=>rm(base,{recursive:true,force:true}));
  const u=new Updater({base,log:()=>{}}),events=[],sha='a'.repeat(40),state={installed_sha:'b'.repeat(40),observed_sha:'b'.repeat(40)};
  await mkdir(join(u.stateRoot,'backups'),{recursive:true});
  u.prepare=async()=>({source:'/candidate',pkg:{version:'2.0.0'}});
  u.build=async()=>{events.push('build');if(failAt==='build')throw Error('build failed');};
  u.candidate=async()=>{events.push('candidate');if(failAt==='candidate')throw Error('candidate failed');};
  u.maintenance=async action=>events.push(action);
  u.backup=async path=>{events.push('backup');await writeFile(path,'backup');};
  u.compose=async image=>{events.push(image==='sha256:old'?'rollback':'activate');if(failAt==='activate'&&image!=='sha256:old')throw Error('activation failed');};
  u.health=async()=>({status:200,body:{ok:true,sync:true,sourceRevision:failAt==='health'?'wrong':sha,nasPackage:'2.0.0'}});
  u.restore=async()=>{events.push('restore-db');if(failAt==='rollback')throw Error('restore failed');};
  return {u,events,sha,state,current:{Image:'sha256:old'}};
}
for(const failure of ['build','candidate'])test('Failed '+failure+' leaves application/database untouched',async t=>{
  const x=await fixture(t,failure);await assert.rejects(x.u.perform(x.sha,x.state,x.current));assert.ok(!x.events.includes('enter'));assert.equal(x.state.installed_sha,'b'.repeat(40));
});
for(const failure of ['activate','health'])test('Failed '+failure+' restores database and image before releasing writes',async t=>{
  const x=await fixture(t,failure);await assert.rejects(x.u.perform(x.sha,x.state,x.current));assert.ok(x.events.indexOf('restore-db')<x.events.indexOf('rollback'));assert.equal(x.events.at(-1),'exit');assert.equal(x.state.installed_sha,'b'.repeat(40));assert.equal(x.state.failed_sha,x.sha);
});
test('Healthy activation commits before releasing maintenance; proxy and source files are untouched',async t=>{
  const x=await fixture(t);x.u.maintenance=async action=>{x.events.push(action);if(action==='exit'){const s=JSON.parse(await readFile(join(x.u.stateRoot,'state.json')));assert.equal(s.installed_sha,x.sha);await assert.rejects(stat(join(x.u.stateRoot,'activation.json')),{code:'ENOENT'});}};
  await x.u.perform(x.sha,x.state,x.current);assert.deepEqual(x.events,['build','candidate','enter','backup','activate','exit']);assert.equal(x.state.installed_sha,x.sha);
});
test('Crash journal restores previous installed state and database before enabling writes',async t=>{
  const x=await fixture(t);const backup=join(x.u.stateRoot,'backups','recovery.sqlite');await writeFile(backup,'db');
  await atomicJSON(join(x.u.stateRoot,'activation.json'),{sha:x.sha,oldImage:'sha256:old',backup,previousState:x.state});
  await atomicJSON(join(x.u.stateRoot,'state.json'),{installed_sha:x.sha});
  await x.u.recover();assert.deepEqual(x.events,['restore-db','rollback','exit']);const state=JSON.parse(await readFile(join(x.u.stateRoot,'state.json')));assert.equal(state.installed_sha,'b'.repeat(40));assert.equal(state.failed_sha,x.sha);
});
test('First start does not label a legacy installation as the current Git commit',async t=>{
  const x=await fixture(t);x.u.request=async()=>({sha:x.sha});x.u.current=async()=>({Config:{Labels:{}}});x.u.health=async()=>({status:200,body:{}});
  await x.u.poll();const state=JSON.parse(await readFile(join(x.u.stateRoot,'state.json')));assert.equal(state.observed_sha,x.sha);assert.equal(state.installed_sha,undefined);
});
