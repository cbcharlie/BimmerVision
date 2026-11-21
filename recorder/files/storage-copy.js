'use strict';
var fs=require('fs'),path=require('path'),crypto=require('crypto'),io=require('./io'),UUID=require('./library').UUID,HEADROOM=4*1024*1024,CHUNK=256*1024;
function failure(code,message){var e=Error(message);e.code=code;return e;}
function cancelled(signal){if(signal&&signal.cancelled)throw failure('ECANCELED','Copy cancelled');}
async function filesFor(library,id){var files=await library.bundle(id),out=[];for(var i=0;i<files.length;i++){var f=files[i],st=await io.safePath(f.path,'file');if(['manifest.json','capture.bvr','mapping.json'].indexOf(f.name)<0)throw Error('Recording contains an unsupported file');out.push({name:f.name,path:f.path,size:st.size});}if(!out.some(function(f){return f.name==='capture.bvr';})||!out.some(function(f){return f.name==='manifest.json';}))throw Error('Recording is incomplete');return out;}
async function digest(file,guard){var fd=null,hash=crypto.createHash('sha256'),size=0;try{await guard.check();fd=await io.open(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));var st=await io.fstat(fd);if(!st.isFile())throw Error('Expected regular recording file');var b=Buffer.alloc(CHUNK);while(size<st.size){await guard.check(fd);var r=await io.read(fd,b,0,Math.min(b.length,st.size-size),size),n=typeof r==='number'?r:r.bytesRead;if(!n)throw Error('Recording file changed while reading');hash.update(b.slice(0,n));size+=n;}return {size:size,sha256:hash.digest('hex')};}finally{if(fd!==null)await io.close(fd);}}
async function sameRecording(source,target,sourceFiles,targetLibrary,id,sourceManifest){var targetManifest;try{targetManifest=await targetLibrary.manifest(id);}catch(e){return false;}if(targetManifest.sessionId!==sourceManifest.sessionId||targetManifest.sequence!==sourceManifest.sequence||targetManifest.bytes!==sourceManifest.bytes)return false;var left=Object.assign({},sourceManifest),right=Object.assign({},targetManifest);['locked','hornLockRevision','hornLockDependency'].forEach(function(k){delete left[k];delete right[k];});if(JSON.stringify(left)!==JSON.stringify(right))return false;var targetFiles;try{targetFiles=await filesFor(targetLibrary,id);}catch(e){return false;}if(sourceFiles.length!==targetFiles.length)return false;for(var i=0;i<sourceFiles.length;i++){var a=sourceFiles[i],b=targetFiles.filter(function(x){return x.name===a.name;})[0];if(!b||a.size!==b.size)return false;if(a.name==='manifest.json')continue;var x=await digest(a.path,source.guard),y=await digest(b.path,target.guard);if(x.sha256!==y.sha256)return false;}return true;}
function chronological(a,b){var at=Date.parse(a.startedAt),bt=Date.parse(b.startedAt);if(!isFinite(at))at=0;if(!isFinite(bt))bt=0;return at-bt||(a.sequence||0)-(b.sequence||0)||a.id.localeCompare(b.id);}
async function inspect(source,target,options){
 options=options||{};if(!source||!target||source.mount===target.mount)throw failure('EINVAL','Choose two different recording locations');await source.guard.check();await target.guard.check();await cleanupTemps(target);
 var allManifests=await source.library.lock(function(){return source.library.backupManifests();});if(allManifests.length>10000)throw Error('This library has too many recordings to copy in one operation');var manifests=allManifests;
 if(Array.isArray(options.recordingIds)){
  if(!options.recordingIds.length||options.recordingIds.length>2000||options.recordingIds.some(function(id){return typeof id!=='string'||!UUID.test(id);})||new Set(options.recordingIds).size!==options.recordingIds.length)throw failure('EINVAL','Invalid selected recording group');
  var byId=new Map(allManifests.map(function(m){return [m.id,m];})),selected=new Set(options.recordingIds),pending=Array.from(selected);
  while(pending.length){var current=byId.get(pending.pop());if(!current)throw failure('ESTALE','Selected recording group changed. Refresh and try again.');if(typeof current.requiresPrevious!=='boolean'||current.previousId!=null&&!UUID.test(current.previousId))throw Error('Recording dependency metadata cannot be checked safely');if(current.requiresPrevious&&current.previousId&&!selected.has(current.previousId)){if(!byId.has(current.previousId))throw Error('A required earlier clip is unavailable; this group cannot be copied safely');selected.add(current.previousId);pending.push(current.previousId);}}
  manifests=allManifests.filter(function(m){return selected.has(m.id);}).sort(chronological);
 }
 var items=[],bytes=0,existing=0,targetNames=await io.readdir(target.root);
 for(var i=0;i<manifests.length;i++){
  var m=manifests[i],files=await filesFor(source.library,m.id),entry=targetNames.indexOf(m.id)>=0;
  if(entry){if(!await sameRecording(source,target,files,target.library,m.id,m))throw failure('EEXIST','A different recording already uses ID '+m.id);var existingManifest=await target.library.manifest(m.id);existing++;items.push({manifest:m,targetManifest:existingManifest,files:files,exists:true,bytes:0});continue;}
  var total=files.reduce(function(n,f){return n+f.size;},0);bytes+=total;items.push({manifest:m,files:files,exists:false,bytes:total});
 }
 var requestedCount=Array.isArray(options.recordingIds)?options.recordingIds.length:manifests.length,result={source:source.mount,destination:target.mount,recordings:items.length,recordingsToCopy:items.length-existing,requestedRecordings:requestedCount,dependencyRecordings:Math.max(0,items.length-requestedCount),alreadyPresent:existing,totalBytes:bytes,requiresRetention:false,willRemoveCount:0,willRemoveBytes:0,canFit:true,freeBytes:null,usedBytes:null};
 if(target.internal){
  var measured=await options.internalStorage.measure(),limit=options.limitBytes,need=bytes?Math.max(0,measured.used+bytes+HEADROOM-limit,bytes+HEADROOM-measured.deviceFree):0,candidates=need?await target.library.backupManifests():[];
  candidates.sort(chronological);var reclaim=0,count=0,locks=target.library.hornLocks;
  for(var j=0;j<candidates.length&&reclaim<need;j++){var c=candidates[j];if(c.locked===true||target.library.readers[c.id]||locks&&locks.apply(c))continue;try{await target.library.assertNoDependencies(c.id);var fsList=await filesFor(target.library,c.id),n=fsList.reduce(function(sum,f){return sum+f.size;},0);reclaim+=n;count++;}catch(e){}}
  result.usedBytes=measured.used;result.freeBytes=Math.max(0,limit-measured.used);result.requiresRetention=need>0;result.willRemoveCount=count;result.willRemoveBytes=reclaim;result.canFit=reclaim>=need;result.requiredReclaimBytes=need;
 }else{
  var space=await require('./usb').space(target.mount);result.freeBytes=space.free;result.usedBytes=space.used;result.canFit=space.free>=bytes+HEADROOM;result.requiredReclaimBytes=Math.max(0,bytes+HEADROOM-space.free);
 }
 return result;
}
async function removeTemp(dir,guard){await guard.check();try{await io.safePath(dir,'directory');}catch(e){if(e.code==='ENOENT')return;throw e;}var names=await io.readdir(dir);for(var i=0;i<names.length;i++){if(['capture.bvr','manifest.json','mapping.json'].indexOf(names[i])<0)throw Error('Unexpected file in temporary copy');await guard.check();await io.safePath(path.join(dir,names[i]),'file');await io.unlink(path.join(dir,names[i]));}await guard.check();await io.rmdir(dir);await io.syncDir(path.dirname(dir));}
async function copyFile(input,output,sourceGuard,targetGuard,expectedSize,onBytes,signal){var from=null,to=null,hash=crypto.createHash('sha256'),size=0;try{
 await sourceGuard.check();await targetGuard.check();var st=await io.safePath(input,'file');from=await io.open(input,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));var opened=await io.fstat(from);if(opened.size!==expectedSize)throw Error('Source recording changed after the copy preview');to=await io.open(output,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW||0),384);var b=Buffer.alloc(CHUNK);
 while(size<st.size){cancelled(signal);await sourceGuard.check(from);await targetGuard.check(to);var r=await io.read(from,b,0,Math.min(b.length,st.size-size),size),n=typeof r==='number'?r:r.bytesRead;if(!n)throw Error('Source recording changed during copy');var part=b.slice(0,n);hash.update(part);await io.writeAll(to,part);size+=n;if(onBytes)onBytes(n);}
 if(size!==st.size||size!==expectedSize)throw Error('Source recording changed during copy');await io.fsync(to);await sourceGuard.check(from);await targetGuard.check(to);
 }finally{if(from!==null)await io.close(from);if(to!==null)await io.close(to);}
 var a=hash.digest('hex'),binfo=await digest(output,targetGuard);if(binfo.size!==size||binfo.sha256!==a)throw Error('Copied recording did not pass integrity verification');return size;
}
async function copy(source,target,plan,options){
 options=options||{};var signal=options.signal,progress=options.progress||function(){},doneBytes=0,doneRecords=0,skipped=plan.alreadyPresent||0,removed=0;await source.guard.check();await target.guard.check();
 cancelled(signal);
 var lockUpdates=plan.items.some(function(x){return x.exists&&x.manifest.locked===true&&x.targetManifest&&x.targetManifest.locked!==true;});if(!plan.recordingsToCopy&&!lockUpdates)return {recordingsDone:plan.recordings,recordingsTotal:plan.recordings,bytesDone:0,bytesTotal:0,alreadyPresent:skipped,removedUnlocked:0};
 if(target.internal){if(!plan.canFit)throw failure('ENOSPC','Not enough removable unlocked clips or partition space');if(plan.requiresRetention)removed=await options.internalStorage.ensureRoom(target.library,options.limitBytes,plan.totalBytes,options.mutate);}
 else if(!plan.canFit)throw failure('ENOSPC','Destination does not have enough free space');
 cancelled(signal);
 var release=await source.library.acquireRecordings(plan.items.filter(function(x){return !x.exists;}).map(function(x){return x.manifest.id;}));
 try{
  await target.guard.check();await io.ensureDir(target.root,448);
  for(var i=0;i<plan.items.length;i++){
   cancelled(signal);var item=plan.items[i];if(item.exists){if(item.manifest.locked===true&&item.targetManifest&&item.targetManifest.locked!==true){await target.library.setLocked(item.manifest.id,true);item.targetManifest.locked=true;}doneRecords++;progress({recordingsDone:doneRecords,recordingsTotal:plan.items.length,bytesDone:doneBytes,bytesTotal:plan.totalBytes,alreadyPresent:skipped,removedUnlocked:removed});continue;}
   await source.guard.check();await target.guard.check();var id=item.manifest.id,final=path.join(target.root,id),temp=path.join(target.root,'.bimmervision-copy-'+id+'-'+crypto.randomBytes(8).toString('hex'));
   try{
    await io.mkdir(temp,448);var ordered=item.files.slice().sort(function(a,b){return a.name==='manifest.json'?1:b.name==='manifest.json'?-1:a.name.localeCompare(b.name);});
    for(var j=0;j<ordered.length;j++){var f=ordered[j];await copyFile(f.path,path.join(temp,f.name),source.guard,target.guard,f.size,function(n){doneBytes+=n;if(options.onProgressBytes)options.onProgressBytes(n);},signal);}
    cancelled(signal);await source.guard.check();await target.guard.check();await io.syncDir(temp);try{await io.lstat(final);throw failure('EEXIST','Destination changed during copy; no recording was overwritten');}catch(e){if(e.code!=='ENOENT')throw e;}
    await io.rename(temp,final);await io.syncDir(target.root);target.library.invalidateSummary();doneRecords++;
    if(target.internal)await options.internalStorage.measure();
    progress({recordingsDone:doneRecords,recordingsTotal:plan.items.length,bytesDone:doneBytes,bytesTotal:plan.totalBytes,alreadyPresent:skipped,removedUnlocked:removed});
   }catch(e){try{await removeTemp(temp,target.guard);}catch(ignore){}throw e;}
  }
  await target.guard.check();return {recordingsDone:doneRecords,recordingsTotal:plan.items.length,bytesDone:doneBytes,bytesTotal:plan.totalBytes,alreadyPresent:skipped,removedUnlocked:removed};
 }finally{release();}
}
module.exports={inspect:inspect,copy:copy,constants:{headroomBytes:HEADROOM,chunkBytes:CHUNK}};
