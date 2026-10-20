import { readFile, writeFile, rename, mkdir, rm, readdir, lstat, cp, unlink, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { execFile as callback, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { join, resolve, relative, isAbsolute } from 'node:path';
const execFile = promisify(callback);
export const REPOSITORY = 'bratkartoffeln/laverna', BRANCH = 'master', PROJECT = 'laverna', CONTAINER = 'laverna-laverna-1';
const API = 'https://api.github.com/repos/' + REPOSITORY;
const wait = ms => new Promise(r => setTimeout(r,ms));
export const validSHA = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
export function verifiedRun(runs, sha) {
  const latest = runs.filter(r => r.head_sha === sha && r.head_branch === BRANCH && r.event === 'push').sort((a,b)=>b.id-a.id || (b.run_attempt||1)-(a.run_attempt||1))[0];
  return latest?.status === 'completed' && latest?.conclusion === 'success';
}
export function archivePathsOK(listing, verbose) {
  const names = listing.trim().split('\n');
  if (!names.length || !names[0]) return false;
  const root = names[0].split('/')[0];
  if (!/^[a-zA-Z0-9_.-]+$/.test(root)) return false;
  return names.every(name => /^[a-zA-Z0-9_./@+ ,()[\]-]+$/.test(name) && name.split('/')[0] === root && !name.split('/').some(p => p === '.' || p === '..')) && verbose.trim().split('\n').length === names.length && verbose.trim().split('\n').every(line => ['-','d'].includes(line[0]));
}
export const retryableError = e => /HTTP (401|403|408|429|5\d\d)|fetch failed|ENOTFOUND|EAI_AGAIN|ECONN|timeout|TLS handshake|network|connection reset/i.test(e.message);
export async function jsonFile(file, fallback = null) { try { return JSON.parse(await readFile(file,'utf8')); } catch(e) {if(e.code === 'ENOENT')return fallback;throw e;} }
export async function atomicJSON(file, value) {await writeFile(file+'.new',JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(file+'.new',file);}
export class Updater {
  constructor({base=process.env.LAVERNA_BASE || '/share/Container/laverna',log=console.log,dryRun=false}={}) {
    this.base=resolve(base);this.app=join(this.base,'laverna-nas');this.stateRoot=join(this.base,'.laverna-updater');this.data=join(this.base,'data');this.log=log;this.dryRun=dryRun;
  }
  async request(path) {
    const headers={'User-Agent':'laverna-nas-updater','Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
    try {const token=(await readFile(join(this.stateRoot,'github-deploy.token'),'utf8')).trim();if(token)headers.Authorization='Bearer '+token;} catch(e){if(e.code!=='ENOENT')throw e;}
    const res=await fetch(API+path,{headers,signal:AbortSignal.timeout(30000)});
    if(!res.ok)throw Error('GitHub API: HTTP '+res.status);
    return res.json();
  }
  async docker(args, options={}) {return (await execFile('docker',args,{timeout:180000,maxBuffer:8*1024*1024,...options})).stdout.trim();}
  async current() {
    const c=JSON.parse(await this.docker(['inspect',CONTAINER]))[0];
    if(c.Name!=='/'+CONTAINER || c.Config.Labels?.['com.docker.compose.project']!==PROJECT || c.Config.Labels?.['com.docker.compose.service']!=='laverna')throw Error('Laverna container identity mismatch');
    if(!c.Mounts.some(m=>m.Destination==='/data' && m.Type==='bind' && (m.Source===this.data || m.Source==='/share/CACHEDEV1_DATA/Container/laverna/data')))throw Error('Unexpected database mount');
    return c;
  }
  async health(container=CONTAINER,path='/ready.json',method='GET') {
    const code="const r=await fetch('http://127.0.0.1:3000'+process.argv[1],{method:process.argv[2],signal:AbortSignal.timeout(15000)});console.log(JSON.stringify({status:r.status,body:await r.json()}));";
    return JSON.parse(await this.docker(['exec',container,'node','--input-type=module','-e',code,path,method],{timeout:25000}));
  }
  async maintenance(action) {
    const result=await this.health(CONTAINER,'/internal/maintenance?action='+action,'POST');
    if(result.status!==200 || result.body.maintenance!==(action==='enter'))throw Error('Maintenance '+action+' failed');
  }
  async download(sha,destination) {
    let url=API+'/tarball/'+sha;
    for(let i=0;i<6;i++) {
      const res=await fetch(url,{headers:{'User-Agent':'laverna-nas-updater'},redirect:'manual',signal:AbortSignal.timeout(120000)});
      if(res.status>=300&&res.status<400){url=new URL(res.headers.get('location'),url).href;if(!['api.github.com','codeload.github.com','github.com'].includes(new URL(url).hostname))throw Error('Unexpected archive redirect');continue;}
      if(!res.ok||!res.body)throw Error('Archive download: HTTP '+res.status);
      await pipeline(Readable.fromWeb(res.body),createWriteStream(destination,{mode:0o600}));return;
    }
    throw Error('Too many archive redirects');
  }
  async prepare(sha) {
    if(!validSHA(sha))throw Error('Invalid source revision');
    const directory=join(this.stateRoot,'staging',sha);await mkdir(directory,{recursive:true});
    const archive=join(directory,'source.tgz');await this.download(sha,archive);
    const list=await execFile('tar',['-tzf',archive],{maxBuffer:4*1024*1024});const verbose=await execFile('tar',['-tvzf',archive],{maxBuffer:4*1024*1024});
    if(!archivePathsOK(list.stdout,verbose.stdout))throw Error('Unsafe source archive');
    const source=join(directory,'source');await mkdir(source,{recursive:true});
    await execFile('tar',['--extract','--gzip','--file',archive,'--directory',source,'--strip-components=1','--no-same-owner','--no-same-permissions']);
    const pkg=await jsonFile(join(source,'nas/server/package.json'));
    if(pkg?.name!=='laverna-nas-server'||!pkg.version||!await stat(join(source,'Dockerfile')))throw Error('Source identity mismatch');
    return {source,pkg};
  }
  async build(source,image,sha) {
    const filename=join(this.stateRoot,'logs','build-'+sha+'.log');
    const log=createWriteStream(filename,{mode:0o600});
    const code=await new Promise((yes,no)=>{
      const child=spawn('docker',['build','--build-arg','LAVERNA_REVISION='+sha,'-t',image,source],{stdio:['ignore','pipe','pipe']});
      child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
      child.once('error',e=>{log.end();no(e);});child.once('close',code=>log.end(()=>yes(code)));
    });
    if(code!==0){const details=(await readFile(filename,'utf8')).slice(-20000);const error=Error('Image build failed; see '+filename);error.retryable=retryableError(Error(details));throw error;}
  }
  async candidate(image,sha) {
    const name='laverna-check-'+sha.slice(0,12);
    await this.docker(['run','-d','--name',name,'--network','none','--read-only','--tmpfs','/data:rw,uid=1000,gid=1000,mode=0700','--tmpfs','/tmp',image]);
    try {for(let i=0;i<30;i++){try{const r=await this.health(name);if(r.status===200&&r.body.ok&&r.body.sync&&r.body.sourceRevision===sha)return;}catch{}await wait(1000);}throw Error('Candidate failed health/source verification');}
    finally {await this.docker(['rm','-f',name]);}
  }
  async compose(image) {
    const file=join(this.stateRoot,'active-image.json');await atomicJSON(file,{services:{laverna:{image}}});
    await this.docker(['compose','-p',PROJECT,'-f',join(this.app,'compose.yaml'),'-f',file,'up','-d','--no-build','--no-deps','--force-recreate','--wait','--wait-timeout','120','laverna']);
  }
  async backup(destination) {
    const output=await this.docker(['exec',CONTAINER,'node','server/admin.mjs','backup']);
    if(!/^\/data\/backups\/laverna-[a-zA-Z0-9_.:-]+\.sqlite$/.test(output))throw Error('Unexpected backup path');
    await cp(join(this.data,output.slice('/data/'.length)),destination);
  }
  async restore(backup) {
    await this.docker(['stop','--time','40',CONTAINER]);
    await cp(backup,join(this.data,'laverna.sqlite'));
    for(const suffix of ['-wal','-shm'])await unlink(join(this.data,'laverna.sqlite'+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e;});
    // Copies made as root must retain the application user's ability to write.
    const {chown,chmod}=await import('node:fs/promises');await chown(join(this.data,'laverna.sqlite'),1000,1000);await chmod(join(this.data,'laverna.sqlite'),0o600);
  }
  async recover() {
    const journal=await jsonFile(join(this.stateRoot,'activation.json'));
    if(!journal)return;
    const backupRelative=typeof journal.backup==='string'?relative(join(this.stateRoot,'backups'),journal.backup):'..';
    if(!journal.oldImage?.startsWith('sha256:')||!validSHA(journal.sha)||backupRelative.startsWith('..')||isAbsolute(backupRelative)||!backupRelative)throw Error('Invalid recovery journal');
    this.log('Recovering interrupted activation '+journal.sha);
    await this.restore(journal.backup);await this.compose(journal.oldImage);
    const state=journal.previousState || {};state.failed_sha=journal.sha;state.last_error='Interrupted activation rolled back';await atomicJSON(join(this.stateRoot,'state.json'),state);
    await unlink(join(this.stateRoot,'activation.json'));
    await this.maintenance('exit');
  }
  async perform(sha,state,current) {
    const image='laverna-app:'+sha;let entered=false,changed=false,releaseSafe=true;
    const previousState=structuredClone(state);
    const backup=join(this.stateRoot,'backups',Date.now()+'-'+sha+'.sqlite');
    try {
      const {source,pkg}=await this.prepare(sha);await this.build(source,image,sha);await this.candidate(image,sha);
      entered=true;await this.maintenance('enter');await this.backup(backup);
      await atomicJSON(join(this.stateRoot,'activation.json'),{sha,oldImage:current.Image,backup,previousState});
      changed=true;await this.compose(image);
      const health=await this.health();
      if(health.status!==200||!health.body.sync||health.body.sourceRevision!==sha||health.body.nasPackage!==pkg.version)throw Error('Activated image failed health/source verification');
      state.installed_sha=sha;state.observed_sha=sha;state.installed_version=pkg.version;state.failed_sha=null;state.last_success=new Date().toISOString();state.backup=backup;
      await atomicJSON(join(this.stateRoot,'state.json'),state);
      // Keep writes frozen until the durable commit point. A crash before this
      // point restores the old database; afterwards it only releases maintenance.
      await unlink(join(this.stateRoot,'activation.json'));changed=false;
      this.log('Installed '+sha+' version '+pkg.version);
    } catch(e) {
      if(changed){releaseSafe=false;await this.restore(backup);await this.compose(current.Image);releaseSafe=true;this.log('Previous Laverna image and database restored.');await unlink(join(this.stateRoot,'activation.json'));}
      for(const key of Object.keys(state))delete state[key];Object.assign(state,previousState);
      state.failed_sha=(e.retryable||retryableError(e))?null:sha;state.last_error=e.message;await atomicJSON(join(this.stateRoot,'state.json'),state);throw e;
    } finally {if(entered&&releaseSafe)await this.maintenance('exit');}
  }
  async poll() {
    for(const name of ['logs','staging','backups'])await mkdir(join(this.stateRoot,name),{recursive:true,mode:0o700});
    let locked=false;
    try {
      try{await mkdir(join(this.stateRoot,'lock'));locked=true;}catch(e){if(e.code==='EEXIST'){this.log('Another updater operation is active.');return;}throw e;}
      if(!this.dryRun)await this.recover();
      // Recover a crash after commit but before the maintenance release.
      if(!this.dryRun)try{await stat(join(this.data,'.update-maintenance'));await this.maintenance('exit');}catch(e){if(e.code!=='ENOENT')throw e;}
      const state=await jsonFile(join(this.stateRoot,'state.json'),{});
      const commit=await this.request('/commits/'+BRANCH);const sha=commit.sha;
      if(!validSHA(sha))throw Error('Invalid GitHub SHA');
      const current=await this.current();
      if(!state.observed_sha){
        const health=await this.health();state.observed_sha=sha;
        if(health.status===200&&health.body.sourceRevision===sha&&current.Config.Labels?.['org.opencontainers.image.revision']===sha)state.installed_sha=sha;
        if(!this.dryRun)await atomicJSON(join(this.stateRoot,'state.json'),state);
        this.log('Initial branch baseline recorded; installed commit recorded only when verified in running image.');return;
      }
      if(state.installed_sha===sha||state.observed_sha===sha){this.log('No new master update.');return;}
      if(state.failed_sha===sha){this.log('Commit previously failed; waiting for a new commit.');return;}
      const runs=await this.request('/actions/workflows/verify.yml/runs?branch='+BRANCH+'&event=push&head_sha='+sha+'&per_page=30');
      if(!verifiedRun(runs.workflow_runs,sha)){this.log('Waiting for successful exact-commit push verification.');return;}
      if(this.dryRun){this.log('Verified update available: '+sha);return;}
      await this.perform(sha,state,current);
    } finally {if(locked)await rm(join(this.stateRoot,'lock'),{recursive:true});}
  }
}
