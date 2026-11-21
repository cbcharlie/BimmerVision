'use strict';
// Paired browser queue controls. No cloud credentials or upload session URLs
// are returned, and removing work never deletes local or remote objects.
var group=require('./backup-drives').group;
var crypto=require('crypto');
function token(c,w){return crypto.createHash('sha256').update(String(c.guard&&c.guard.identity)+':'+String(w.data.account&&w.data.account.generation)).digest('hex');}
var UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function number(n){return typeof n==='number'&&isFinite(n)&&n>=0?n:0;}
function Queue(service){this.service=service;this.serial=Promise.resolve();}
Queue.prototype.status=async function(){
 var s=this.service,w=s.worker,c=s.options.context(),source=c.guard&&c.guard.identity;
 var manifests=c.library&&source?await c.library.backupManifests():[];
 // Do not display another recording store's receipts against the current library.
 if(s.options.context().library!==c.library||s.options.context().guard!==c.guard)throw Error('Recording storage changed');
 var status=s.status(),settings=w.data.settings,receipts=w.data.queue||[],active=w.phone&&w.phone.live(),now=Date.now();
 var drives=group(manifests).reverse().map(function(d){
  var allLocked=d.clips.every(function(m){return m.locked===true;}),view=(status.drives||[]).filter(function(v){return v.id===d.id;})[0];
  var clips=d.clips.map(function(m){
   var r=receipts.filter(function(r){return r.source===source&&r.clipId===m.id;})[0];
   var auto=settings.autoUpload&&(!settings.onlyLockedDrives||allLocked||m.locked===true&&m.hornLockRevision>0);
   var queued=!!(r&&!r.excluded&&r.manual||auto&&!(r&&r.excluded));
   var files=r&&r.files||[],total=files.reduce(function(n,f){return n+number(f.size);},0)||number(m.bytes),sent=files.reduce(function(n,f){return n+Math.min(number(f.size),f.done?number(f.size):number(f.offset));},0);
   var phone=active&&active.currentClipId===m.id;
   var state=r&&r.excluded?'Removed':r&&r.done?'Complete':phone?'Uploading via phone':queued?status.activeClipId===m.id&&/^(Uploading|Verifying)$/.test(status.state)?status.state:'Queued':'Not queued';
   return {id:m.id,startedAt:m.startedAt||null,bytes:total,confirmedBytes:sent,progress:total?Math.min(1,sent/total):0,queued:queued&&!(r&&r.done),state:state,locked:m.locked===true};
  });
  return {id:d.id,startedAt:d.startedAt,clips:clips};
 });
 return {apiVersion:1,sourceToken:token(c,w),configured:!!w.data.account,state:status.state||'Remote backup off',message:status.message||'',storageFull:status.storageFull===true,wifiEligible:!!(status.wifi&&status.wifi.eligible),viewerConnected:status.viewerConnected===true,phoneProgress:active&&active.progress?{bytes:active.progress.bytes,total:active.progress.total}:null,transport:active?'phone':/^Uploading|^Verifying/.test(status.state||'')?'car-wifi':null,autoUpload:!!settings.autoUpload,pauseRecording:!!settings.pauseRecording,onlyLockedDrives:!!settings.onlyLockedDrives,doNotBackupWhileDriving:!!settings.doNotBackupWhileDriving,stationaryPermitted:status.stationaryPermitted===true,bytesPerSecond:number(status.bytesPerSecond),etaSeconds:typeof status.etaSeconds==='number'?number(status.etaSeconds):null,drives:drives,completed:(status.completed||[]).slice(0,5).map(function(d){return {id:d.id,startedAt:d.startedAt||null,completedAt:d.completedAt||null,totalClips:number(d.totalClips)||(Array.isArray(d.clipIds)?d.clipIds.length:0)};}),updatedAt:now};
};
Queue.prototype.change=function(body){
 var self=this,s=this.service,w=s.worker,commands=s.commands,phoneMutation=s.phoneMutation;
 var run=this.serial.then(async function(){
  s.mutations=(s.mutations||0)+1;s.queueEditing=(s.queueEditing||0)+1;
  try{
   if(commands)await commands;if(phoneMutation)await phoneMutation;
   if(s.closed)throw Error('Remote backup closed');
   if(!body||['add','remove'].indexOf(body.action)===-1||!Array.isArray(body.clipIds)||!body.clipIds.length||body.clipIds.length>1000||body.clipIds.some(function(id){return typeof id!=='string'||!UUID.test(id);})||new Set(body.clipIds.map(function(id){return id.toLowerCase();})).size!==body.clipIds.length)throw Error('Select 1 to 1000 distinct recordings');
   if(!w.data.account)throw Error('Set up Remote Backup in the car first');
   // Stop the owning phone lease and Wi-Fi request before changing selection.
   var phoneActive=w.phone&&w.phone.live();
   if(s.cancel&&!(body.action==='add'&&phoneActive))s.cancel();if(s.busy)await s.busy;
   var c=s.options.context(),guard=c.guard,library=c.library,account=w.data.account,releases=[];
   if(!guard||!library)throw Error('Waiting for recording storage');
   if(body.sourceToken&&body.sourceToken!==token(c,w))throw Error('Recording storage or Google account changed');
   async function check(){if(s.closed)throw Error('Remote backup closed');var current=s.options.context();if(current.guard!==guard||current.library!==library||w.data.account!==account)throw Error('Recording storage changed');await guard.check();}
   try{
    await check();var manifests=await library.backupManifests();
    body.clipIds.forEach(function(id){if(!manifests.some(function(m){return m.id===id&&m.complete===true;}))throw Error('Selected recording is not complete or available');});
    for(var i=0;i<body.clipIds.length;i++){releases.push(await library.acquire(body.clipIds[i]));await check();}
    manifests=await library.backupManifests();body.clipIds.forEach(function(id){if(!manifests.some(function(m){return m.id===id&&m.complete===true;}))throw Error('Selected recording is no longer complete');});await check();
    var previous=w.data.queue,queue=previous.slice();
    body.clipIds.forEach(function(id){var index=queue.findIndex(function(r){return r.clipId===id&&r.source===guard.identity;}),r=index<0?{clipId:id,source:guard.identity,files:[],folder:{},done:false}:Object.assign({},queue[index]);r.manual=body.action==='add';r.excluded=body.action==='remove';if(index<0)queue.push(r);else queue[index]=r;});
    if(Buffer.byteLength(JSON.stringify(Object.assign({},w.data,{queue:queue})))>24*1024*1024)throw Error('Remote backup queue is full');
    w.data.queue=queue;try{await w.save();}catch(e){w.data.queue=previous;throw e;}
    w.scanAt=0;w.retryAt=0;if(w.view){w.view.drives=[];w.view.pending=body.action==='add'||w.view.pending;}
    return {changed:body.clipIds.length,action:body.action};
   }finally{releases.forEach(function(release){release();});}
  }finally{s.mutations--;s.queueEditing--;}
 });
 this.serial=run.catch(function(){});s.queueMutation=this.serial;return run;
};
module.exports={Queue:Queue};
