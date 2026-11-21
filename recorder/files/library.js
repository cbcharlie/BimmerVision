'use strict';
var fs=require('fs'),path=require('path'),crypto=require('crypto'),io=require('./io');
var UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function error(code,message){var e=Error(message);e.statusCode=code;return e;}
// A recorder reserves the next segment's predecessor before publishing it.
// This covers the brief interval where neither an active directory nor its
// successor manifest exists. Leases are process-local; persisted partials cover
// recovery after a process restart.
var predecessorLeases=new Map();
function reservePredecessor(root){var key=path.resolve(root),leases=predecessorLeases.get(key);if(!leases){leases=new Set();predecessorLeases.set(key,leases);}var token={id:null},released=false;leases.add(token);return {protect:function(id){if(released)throw Error('Predecessor lease released');if(id!==null&&!UUID.test(id))throw Error('Invalid predecessor UUID');token.id=id;},release:function(){if(released)return;released=true;leases.delete(token);if(!leases.size)predecessorLeases.delete(key);}};}
function assertUnreserved(root,id){var leases=predecessorLeases.get(root),blocked=false;if(leases)leases.forEach(function(lease){if(lease.id===id)blocked=true;});if(blocked)throw error(409,'Recording is reserved for an active successor');}
async function readManifest(root,id,partial){var dir=path.join(root,id+(partial?'.partial':''));await io.safePath(dir,'directory');await io.safePath(path.join(dir,'capture.bvr'),'file');var file=path.join(dir,'manifest.json');await io.safePath(file,'file');var fd=await io.open(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)),m;
 try{var st=await io.fstat(fd);if(!st.isFile()||st.size>1048576)throw Error('Invalid manifest file/size');m=JSON.parse((await io.readAt(fd,st.size,0)).toString('utf8'));}finally{await io.close(fd);}
 if(m.id!==id||m.schemaVersion!==1||m.format!=='bvr1')throw Error('Invalid recording manifest');return m;}
function Library(root,options){options=options||{};this.root=path.resolve(root);this.guard=options.guard;this.activeId=options.activeId||function(){return null;};this.readers={};this.serial=Promise.resolve();this.mutating=false;this.summaryCache=new Map();this.summaryRevision=0;this.overviews=new (require('./recording-overview'))({cacheDir:options.cacheDir});}
Library.prototype.invalidateSummary=function(){this.summaryRevision++;this.summaryCache.clear();};
Library.prototype.check=async function(){try{if(!this.guard||typeof this.guard.check!=='function')throw Error('Storage guard required');await this.guard.check();await io.safePath(this.root,'directory');}catch(e){this.overviews.cancel();throw error(503,e.message);}};
Library.prototype.id=function(id){if(typeof id!=='string'||!UUID.test(id))throw error(400,'Invalid recording UUID');return id;};
Library.prototype.manifest=async function(id){this.id(id);return readManifest(this.root,id,false);};
Library.prototype.assertNoDependencies=async function(id){
 assertUnreserved(this.root,id);var names=await io.readdir(this.root);
 for(var i=0;i<names.length;i++){var name=names[i],partial=name.endsWith('.partial'),successor=partial?name.slice(0,-8):name;if(!UUID.test(successor)||successor===id)continue;var m;
  try{try{m=await readManifest(this.root,successor,partial);}catch(e){if(!partial||e.code!=='ENOENT')throw e;/* Atomic finalization may have renamed this partial since readdir. */m=await readManifest(this.root,successor,false);}if(typeof m.requiresPrevious!=='boolean'||(m.previousId!=null&&!UUID.test(m.previousId)))throw Error('Invalid dependency metadata');}
  catch(e){throw error(409,'Recording dependencies cannot be checked safely');}
  if(m.requiresPrevious&&m.previousId===id)throw error(409,'Recording is required by a retained successor');
 }
 assertUnreserved(this.root,id);
};
Library.prototype.list=async function(){await this.check();var names=await io.readdir(this.root),out=[];for(var i=0;i<names.length;i++){if(!UUID.test(names[i]))continue;try{var m=await this.manifest(names[i]),active=typeof this.activeId==='function'?this.activeId():this.activeId;if(m.complete===true&&active!==names[i]){try{var overview=await this.overviews.index(path.join(this.root,names[i],'capture.bvr'),m);m.route=overview.route;m.endpoints=overview.endpoints;m.routeStatus=overview.routeStatus;}catch(overviewError){m.route=[];m.endpoints=null;}out.push(m);}}catch(e){}}return out.sort(function(a,b){return String(a.sessionId||'').localeCompare(String(b.sessionId||''))||(a.sequence||0)-(b.sequence||0)||a.id.localeCompare(b.id);});};
// Cloud scheduling needs manifests only; never build playback/GPS overviews here.
Library.prototype.backupManifests=async function(){await this.check();var names=await io.readdir(this.root),out=[],active=typeof this.activeId==='function'?this.activeId():this.activeId;for(var i=0;i<names.length;i++){if(!UUID.test(names[i])||names[i]===active)continue;try{var m=await this.manifest(names[i]);if(m.complete===true)out.push(m);}catch(e){}}return out;};
// Grouped drive locks use the same manifests as playback and remote backup.
Library.prototype.driveGroups=async function(){
 var drives=require('./backup-drives').group(await this.backupManifests());
 return drives.map(function(d){var count=d.clips.filter(function(m){return m.locked===true;}).length;return {id:d.id,startedAt:d.startedAt,membership:crypto.createHash('sha256').update(d.clips.map(function(m){return m.id;}).join(',')).digest('hex'),totalClips:d.clips.length,lockedClips:count,locked:count===d.clips.length,mixed:count>0&&count<d.clips.length,bytes:d.bytes,durationSeconds:d.clips.reduce(function(n,m){return n+(Number(m.durationSeconds)||0);},0)};}).sort(function(a,b){return (Date.parse(b.startedAt)||0)-(Date.parse(a.startedAt)||0)||b.id.localeCompare(a.id);});
};
Library.prototype.setDriveLocked=function(id,membership,locked){
 var self=this;return this.lock(async function(){
  self.id(id);if(typeof locked!=='boolean'||typeof membership!=='string')throw error(400,'Invalid drive lock request');
  await self.check();var groups=require('./backup-drives').group(await self.backupManifests()),drive=groups.filter(function(d){return d.id===id;})[0];
  if(!drive||crypto.createHash('sha256').update(drive.clips.map(function(m){return m.id;}).join(',')).digest('hex')!==membership)throw error(409,'Drive changed. Refresh the drive list and try again.');
  for(var i=0;i<drive.clips.length;i++){var cid=drive.clips[i].id,active=typeof self.activeId==='function'?self.activeId():self.activeId;if(cid===active||self.readers[cid])throw error(409,'Recording is active or transferring. Try again shortly.');assertUnreserved(self.root,cid);await self.resolve(cid,'manifest.json');}
  self.mutating=true;
  try{for(var j=0;j<drive.clips.length;j++){await self.check();var m=await self.manifest(drive.clips[j].id);m.locked=locked;await io.atomicJSON(path.join(self.root,m.id,'manifest.json'),m);await io.syncDir(path.join(self.root,m.id));}return {id:id,locked:locked,totalClips:drive.clips.length};}
  finally{self.mutating=false;self.invalidateSummary();}
 });
};
Library.prototype.resolve=async function(id,file){this.id(id);if(file!=='capture.bvr'&&file!=='manifest.json'&&file!=='mapping.json')throw error(400,'File is not allowlisted');await this.check();try{var m=await this.manifest(id),active=typeof this.activeId==='function'?this.activeId():this.activeId;if(m.complete!==true||active===id)throw error(404,'Recording is not finalized');return path.join(this.root,id,file);}catch(e){if(e.statusCode)throw e;throw error(404,'Recording unavailable');}};
Library.prototype.bundle=async function(id){this.id(id);await this.check();await this.resolve(id,'manifest.json');var dir=path.join(this.root,id),out=[{name:'manifest.json',path:path.join(dir,'manifest.json')},{name:'capture.bvr',path:path.join(dir,'capture.bvr')}];try{await io.safePath(path.join(dir,'mapping.json'),'file');out.push({name:'mapping.json',path:path.join(dir,'mapping.json')});}catch(e){}for(var i=0;i<out.length;i++)await io.safePath(out[i].path,'file');return out;};
Library.prototype.lock=function(fn){var self=this;var next=this.serial.then(async function(){if(self.hornLocks)await self.hornLocks.reconcile();return fn();});this.serial=next.catch(function(){});return next;};
Library.prototype.acquire=function(id){var self=this;return this.lock(async function(){await self.resolve(id,'capture.bvr');self.readers[id]=(self.readers[id]||0)+1;var released=false;return function(){if(released)return;released=true;self.readers[id]--;if(!self.readers[id])delete self.readers[id];};});};
// Hold every member of an eligible drive so per-clip web mutations cannot
// change its lock eligibility while a chunk is being sent.
Library.prototype.acquireRecordings=function(ids){var self=this;return this.lock(async function(){var unique=Array.from(new Set(ids));for(var i=0;i<unique.length;i++)await self.resolve(unique[i],'capture.bvr');unique.forEach(function(id){self.readers[id]=(self.readers[id]||0)+1;});var released=false;return function(){if(released)return;released=true;unique.forEach(function(id){self.readers[id]--;if(!self.readers[id])delete self.readers[id];});};});};
var DELETE_FILES=['capture.bvr','manifest.json','manifest.json.new','mapping.json','mapping.json.new'];
async function removable(dir){await io.safePath(dir,'directory');var files=await io.readdir(dir);for(var i=0;i<files.length;i++){if(DELETE_FILES.indexOf(files[i])<0)throw error(409,'Recording contains a file outside deletion allowlist');await io.safePath(path.join(dir,files[i]),'file');}return files;}
async function cleanup(dir,guard){var files=await removable(dir);for(var i=0;i<files.length;i++){await guard.check();var file=path.join(dir,files[i]);await io.safePath(file,'file');await io.unlink(file);}await guard.check();await io.safePath(dir,'directory');await io.rmdir(dir);}
Library.cleanupTrash=async function(root,guard){
 await guard.check();await io.safePath(root,'directory');var trash=path.join(root,'.trash'),out={removed:0,errors:[]};try{await io.safePath(trash,'directory');}catch(e){if(e.code==='ENOENT')return out;throw e;}var names=await io.readdir(trash);
 for(var i=0;i<names.length;i++){if(!/^[a-f0-9-]{36}-[a-f0-9]{16}$/i.test(names[i])||!UUID.test(names[i].slice(0,36)))continue;try{await cleanup(path.join(trash,names[i]),guard);out.removed++;}catch(e){out.errors.push({name:names[i],error:e.message});}}
 await guard.check();await io.syncDir(trash);return out;
};
Library.prototype.remove=function(id){var self=this;return this.lock(async function(){self.id(id);await self.check();var active=typeof self.activeId==='function'?self.activeId():self.activeId;if(active===id||self.readers[id])throw error(409,'Recording is active or transferring');var m=await self.manifest(id);if(m.locked)throw error(403,'Recording is locked. Unlock it before deleting.');await self.resolve(id,'manifest.json');await self.assertNoDependencies(id);var dir=path.join(self.root,id);await removable(dir);self.mutating=true;try{var trash=path.join(self.root,'.trash');await io.ensureDir(trash);await self.check();var staged=path.join(trash,id+'-'+crypto.randomBytes(8).toString('hex'));assertUnreserved(self.root,id);if(self.hornLocks&&self.hornLocks.apply(m))throw error(409,'Horn protection changed. Try again shortly.');await io.rename(dir,staged);await io.syncDir(self.root);await cleanup(staged,self.guard);await io.syncDir(trash);return {deleted:id};}finally{self.mutating=false;self.invalidateSummary();}});};
Library.prototype.setLocked=function(id,locked){var self=this;return this.lock(async function(){self.id(id);await self.check();var active=typeof self.activeId==='function'?self.activeId():self.activeId;if(active===id||self.readers[id])throw error(409,'Recording is active or transferring');var m=await self.manifest(id);m.locked=Boolean(locked);var manifestFile=path.join(self.root,id,'manifest.json');try{await io.atomicJSON(manifestFile,m);await io.syncDir(path.join(self.root,id));return {id:id,locked:m.locked};}finally{self.invalidateSummary();}});};
// Camera identity is supplementary metadata; originals remain byte-for-byte intact.
Library.prototype.setMapping=function(id,mapping){var self=this;return this.lock(async function(){
 self.id(id);
 if(!mapping||mapping.schemaVersion!==1||mapping.confirmed!==true||
   ['frontRear','leftRight'].indexOf(mapping.phase0)<0||['frontRear','leftRight'].indexOf(mapping.phase1)<0||
   mapping.phase0===mapping.phase1||typeof mapping.flipHalves!=='boolean')throw error(400,'Invalid confirmed camera mapping');
 await self.check();await self.manifest(id);
 var active=typeof self.activeId==='function'?self.activeId():self.activeId;
 if(active===id||self.readers[id])throw error(409,'Recording is active or transferring');
 var file=path.join(self.root,id,'mapping.json');
 try{await io.safePath(file,'file');}catch(e){if(e.code!=='ENOENT')throw e;}
 var value={schemaVersion:1,confirmed:true,phase0:mapping.phase0,phase1:mapping.phase1,flipHalves:mapping.flipHalves};
 await io.atomicJSON(file,value);await io.syncDir(path.dirname(file));return value;
});};
Library.prototype.summary=async function(){
 await this.check();var revision=this.summaryRevision,cache=this.summaryCache,nextCache=new Map(),names=(await io.readdir(this.root)).filter(function(n){return UUID.test(n);}),locked=0,unknown=false;
 // Counts are informational only. Mutations always read fresh manifests with
 // their existing path/USB guards; this cache is never consulted by them.
 for(var i=0;i<names.length;i++){try{
  var id=names[i],dir=path.join(this.root,id),directory=await io.lstat(dir),file=await io.lstat(path.join(dir,'manifest.json'));
  if(!directory.isDirectory()||directory.isSymbolicLink()||!file.isFile()||file.isSymbolicLink())throw Error('Unsafe recording path');
  var fingerprint=[directory.dev,directory.ino,directory.mtime.getTime(),directory.ctime.getTime(),file.dev,file.ino,file.size,file.mtime.getTime(),file.ctime.getTime()].join(':'),entry=cache.get(id);
  if(!entry||entry.fingerprint!==fingerprint){var m=await this.manifest(id);entry={fingerprint:fingerprint,locked:m.locked===true,unknown:m.locked!=null&&typeof m.locked!=='boolean'};}
  if(entry.locked)locked++;if(entry.unknown)unknown=true;if(nextCache.size<2048)nextCache.set(id,entry);
 }catch(e){unknown=true;}}
 if(revision===this.summaryRevision)this.summaryCache=nextCache;
 return {recordingCount:names.length,lockedRecordingCount:unknown?null:locked};
};
Library.prototype.count=async function(){return (await this.summary()).recordingCount;};
Library.prototype.removeAll=function(){var self=this;return this.lock(async function(){
 await self.check();var active=typeof self.activeId==='function'?self.activeId():self.activeId;
 if(active||Object.keys(self.readers).some(function(id){return self.readers[id]>0;}))throw error(409,'Recording is active or transferring');
 var names=(await io.readdir(self.root)).filter(function(n){return UUID.test(n)||n.endsWith('.partial')&&UUID.test(n.slice(0,-8));});
 for(var i=0;i<names.length;i++){assertUnreserved(self.root,names[i].slice(0,36));await removable(path.join(self.root,names[i]));}
 var lockedIds=new Set(), manifests=new Map();
 for(var k=0;k<names.length;k++){
  var n=names[k], pid=n.slice(0,36), isPartial=n.endsWith('.partial');
  try{
   var mf=await readManifest(self.root,pid,isPartial);
   if(mf.locked!=null&&typeof mf.locked!=='boolean'||typeof mf.requiresPrevious!=='boolean'||mf.requiresPrevious&&mf.previousId!=null&&!UUID.test(mf.previousId))throw Error('Invalid lock/dependency metadata');
   if(self.hornLocks)self.hornLocks.apply(mf);
   manifests.set(pid,mf);
   if(mf.locked)lockedIds.add(pid);
  }catch(e){throw error(409,'Recording lock/dependency metadata cannot be checked safely. Nothing deleted.');}
 }
 var protectedIds=new Set(lockedIds);
 var added=true;
 while(added){
  added=false;
  manifests.forEach(function(mf,mid){
   if(protectedIds.has(mid)&&mf.requiresPrevious&&mf.previousId&&!protectedIds.has(mf.previousId)){
    protectedIds.add(mf.previousId);
    added=true;
   }
  });
 }
 var toDelete=names.filter(function(n){return !protectedIds.has(n.slice(0,36));});
 var retained={locked:lockedIds.size,retainedDependencies:protectedIds.size-lockedIds.size};
 if(!toDelete.length)return Object.assign({deleted:0},retained);
 self.mutating=true;
 try{var trash=path.join(self.root,'.trash');await io.ensureDir(trash);
  for(var j=0;j<toDelete.length;j++){await self.check();assertUnreserved(self.root,toDelete[j].slice(0,36));var staged=path.join(trash,toDelete[j].slice(0,36)+'-'+crypto.randomBytes(8).toString('hex'));if(self.hornLocks&&self.hornLocks.pending)throw error(409,'Horn protection changed. Try again shortly.');await io.rename(path.join(self.root,toDelete[j]),staged);await io.syncDir(self.root);await cleanup(staged,self.guard);}
  await io.syncDir(trash);await io.syncDir(self.root);return Object.assign({deleted:toDelete.length},retained);
 }finally{self.mutating=false;self.invalidateSummary();}
});};
module.exports={Library:Library,UUID:UUID,reservePredecessor:reservePredecessor};
