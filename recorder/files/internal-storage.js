'use strict';
var fs=require('fs'),path=require('path'),io=require('./io'),usb=require('./usb'),preference=require('./recording-preference');
var BASE='/var/opt/bimmervision-recorder/internal-storage',ROOT=path.join(BASE,'BimmerVision'),HEADROOM=4*1024*1024,SCAN_INTERVAL_MS=2000,MAX_NODES=100000;
function noSpace(message){var e=Error(message);e.code='ENOSPC';return e;}
async function usage(root){
 var stack=[root],total=0,nodes=0;
 while(stack.length){var dir=stack.pop(),names=await io.readdir(dir);
  for(var i=0;i<names.length;i++){if(++nodes>MAX_NODES)throw Error('Internal recording storage contains too many files');var file=path.join(dir,names[i]),st=await io.lstat(file);
   if(st.isSymbolicLink())throw Error('Symlink found in internal recording storage');
   if(st.isDirectory())stack.push(file);
   else if(st.isFile())total+=st.size;
   else throw Error('Unsupported file in internal recording storage');
  }
 }
 return total;
}
function InternalStorage(options){var o=options||{};this.base=path.resolve(o.base||BASE);this.root=path.resolve(o.root||path.join(this.base,'BimmerVision'));this.baseDevice=null;this.baseInode=null;this.rootInode=null;this.lastScan=0;this.usedBytes=0;this.deviceFree=null;this.guard=null;}
InternalStorage.prototype.initialize=async function(){
 var data=await io.stat('/var/opt'),system=await io.stat('/');
 if(data.dev===system.dev)throw Error('/var/opt is not on a separate persistent data partition');
 await io.ensureDir(this.base,448);await io.chmod(this.base,448);
 var base=await io.safePath(this.base,'directory');
 if(base.dev!==data.dev)throw Error('Internal recording directory is outside the /var/opt data partition');
 await io.ensureDir(this.root,448);await io.chmod(this.root,448);
 var root=await io.safePath(this.root,'directory');
 if(root.dev!==data.dev)throw Error('Internal recordings are not on the /var/opt data partition');
 this.baseDevice=data.dev;this.baseInode=base.ino;this.rootInode=root.ino;
 var self=this;this.guard={check:async function(fd){
  await io.safePath('/var/opt','directory');var mounted=await io.stat('/var/opt'),b=await io.safePath(self.base,'directory'),r=await io.safePath(self.root,'directory');
  if(mounted.dev!==self.baseDevice||b.dev!==self.baseDevice||b.ino!==self.baseInode||r.dev!==self.baseDevice||r.ino!==self.rootInode)throw Error('Internal storage mount changed');
  if(fd!=null){var f=await io.fstat(fd);if(f.dev!==self.baseDevice)throw Error('Recording descriptor is outside internal storage');}
 },identity:'internal:'+String(data.dev)+':'+String(base.ino)};
 await this.guard.check();this.lastScan=0;await this.measure();return this;
};
InternalStorage.prototype.measure=async function(){
 if(!this.guard)throw Error('Internal storage is not initialized');await this.guard.check();
 this.usedBytes=await usage(this.root);var space=await usb.space(this.base);this.deviceFree=space.free;this.lastScan=Date.now();return {used:this.usedBytes,deviceFree:this.deviceFree};
};
InternalStorage.prototype.volume=async function(limitBytes){
 if(!preference.validInternalLimit(limitBytes))limitBytes=preference.DEFAULT_INTERNAL_LIMIT;
 await this.measure();return {id:'internal',mount:'internal',volume:'internal',name:'Internal storage',internal:true,total:limitBytes,used:this.usedBytes,free:Math.max(0,limitBytes-this.usedBytes),deviceFree:this.deviceFree};
};
InternalStorage.prototype.ensureRoom=async function(library,limitBytes,requiredBytes,mutate){
 if(!preference.validInternalLimit(limitBytes))limitBytes=preference.DEFAULT_INTERNAL_LIMIT;
 requiredBytes=Math.max(0,Number(requiredBytes)||0);
 if(requiredBytes+HEADROOM>limitBytes)throw noSpace('Internal storage limit is too small for the next recording write');
 if(Date.now()-this.lastScan>SCAN_INTERVAL_MS||!this.lastScan)await this.measure();
 var used=this.usedBytes,deviceFree=this.deviceFree,removed=0;
 if(used+requiredBytes+HEADROOM<=limitBytes&&deviceFree>=requiredBytes+HEADROOM)return 0;
 var self=this;async function evict(){
  while(used+requiredBytes+HEADROOM>limitBytes||deviceFree<requiredBytes+HEADROOM){
   var manifests=await library.backupManifests();
   manifests.sort(function(a,b){var at=Date.parse(a.startedAt),bt=Date.parse(b.startedAt);if(!isFinite(at))at=0;if(!isFinite(bt))bt=0;return at-bt||(a.sequence||0)-(b.sequence||0)||a.id.localeCompare(b.id);});
   var freed=false;
   for(var i=0;i<manifests.length;i++){
    try{await library.remove(manifests[i].id);freed=true;removed++;break;}
    catch(e){if(e.statusCode===403||e.statusCode===404||e.statusCode===409)continue;throw e;}
   }
   if(!freed)throw noSpace('Internal storage is full; only protected recordings remain');
   await self.measure();used=self.usedBytes;deviceFree=self.deviceFree;
  }
 }
 if(typeof mutate==='function')await mutate(evict);else await evict();
 return removed;
};
InternalStorage.prototype.commitWrite=function(bytes){if(Number.isFinite(bytes)&&bytes>0)this.usedBytes+=bytes;};
module.exports={InternalStorage:InternalStorage,usage:usage,constants:{base:BASE,root:ROOT,headroomBytes:HEADROOM}};
