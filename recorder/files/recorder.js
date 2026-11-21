'use strict';
var fs=require('fs'),path=require('path'),crypto=require('crypto'),io=require('./io'),archive=require('./archive'),rtp=require('./rtp'),UUID=require('./library').UUID;
function uuid(){var b=crypto.randomBytes(16);b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;var s=b.toString('hex');return s.slice(0,8)+'-'+s.slice(8,12)+'-'+s.slice(12,16)+'-'+s.slice(16,20)+'-'+s.slice(20);}
function nowUs(){var t=process.hrtime();return t[0]*1000000+Math.floor(t[1]/1000);}
function clock(){var d=new Date(),year=d.getFullYear();return {iso:d.toISOString(),source:'head-unit-system',verified:year>=2020&&year<=2100,utcOffsetMinutes:-d.getTimezoneOffset()};}
function keyframe(p){return rtp.syncPayload(p.payload);}
var DEFAULT_QUEUE_LIMIT=64*1024*1024,MAX_QUEUE_LIMIT=96*1024*1024,BATCH_RECORDS=256,BATCH_BYTES=1024*1024,SYNC_BUSY_US=3000000,SYNC_IDLE_US=1000000;
function Recorder(options){
 var o=options||{};if(!o.root||!o.guard||typeof o.guard.check!=='function')throw Error('Recording root and storage guard required');
 this.root=path.resolve(o.root);this.guard=o.guard;this.ensureCapacity=typeof o.ensureCapacity==='function'?o.ensureCapacity:null;this.capacityWritten=typeof o.capacityWritten==='function'?o.capacityWritten:null;this.nowUs=o.nowUs||nowUs;this.clock=o.clock||clock;this.queueLimit=o.queueLimit==null?DEFAULT_QUEUE_LIMIT:o.queueLimit;this.segmentUs=o.segmentUs==null?120000000:o.segmentUs;this.overrunUs=o.overrunUs==null?10000000:o.overrunUs;this.maxSegmentBytes=o.maxSegmentBytes||1900*1024*1024;
 this.hornLocks=o.hornLocks||null;this.timelineId=this.hornLocks?this.hornLocks.timelineId:require('./horn-lock').timelineId();
 this.initialEvents=typeof o.initialEvents==='function'?o.initialEvents:(Array.isArray(o.initialEvents)?function(){return o.initialEvents;}:null);
 if(this.queueLimit<38||!Number.isSafeInteger(this.queueLimit))throw Error('Queue limit too small');if(this.queueLimit>MAX_QUEUE_LIMIT)this.queueLimit=MAX_QUEUE_LIMIT;this.predecessorLease=require('./library').reservePredecessor(this.root);
 this.queue=[];this.queuedBytes=0;this.pendingDrops=0;this.pendingEvents=0;this.dropped=0;this.accepted=0;this.writtenVideoPackets=0;this.lastVideoWriteUs=null;this.sequence=0;this.sessionId=uuid();this.previousId=null;this.current=null;this.running=null;this.stopping=false;this.stopped=false;this.state='Waiting for stream';this.error=null;this.streamBoundary={};this.captureGroups={};this.pendingSequenceGaps=0;this.lastDropUs=0;this.latestAt=0;this.observedGaps=0;this.syncRequested=false;
 var reorder=o.reorderWindow==null?128:o.reorderWindow;var self=this;this.units=new rtp.AccessUnits(function(){},function(e){if(e.reason==='rtp-sequence-gap'){self.observedGaps+=e.packets||0;}self.event(e,e.atUs);},{window:reorder,metadataOnly:true});this.syncTimer=setInterval(function(){if(!self.stopping&&!self.error&&self.current){self.syncRequested=true;self.kick();}},1000);if(this.syncTimer.unref)this.syncTimer.unref();
}
Recorder.prototype.status=function(){var warn='';if(this.queuedBytes>=(this.queueLimit>>1))warn='USB write is falling behind. Use a drive with faster sustained writes.';if(this.dropped>0)warn='Recording dropped frames. Use a drive with faster sustained writes.';return {state:this.state,activeId:this.current?this.current.id:null,error:this.error,queuedBytes:this.queuedBytes,storageWarning:warn,metrics:{lastVideoWriteMonotonicUs:this.lastVideoWriteUs,writtenVideoPackets:this.writtenVideoPackets,queuedBytes:this.queuedBytes,queueLimit:this.queueLimit,packets:this.accepted,applicationDroppedPackets:this.dropped,observedSequenceGaps:this.observedGaps,nativeReceiverDrops:null}};};
Recorder.prototype.packet=function(packet,atUs){
 if(this.stopping||this.stopped||this.error)return false;atUs=atUs==null?this.nowUs():atUs;
 var data;try{data=archive.record(1,atUs,packet);}catch(e){this.event({type:'discontinuity',reason:'invalid-packet',message:e.message},Number.isSafeInteger(atUs)&&atUs>=0?atUs:this.nowUs());return false;}
 // Keep parsed views on the immutable archive copy, so the queue neither
 // retains an extra packet buffer nor depends on the caller retaining it.
 var p=null,group=null;try{p=rtp.parsePacket(data.slice(24));}catch(e){}
 if(p){if(!Object.prototype.hasOwnProperty.call(this.streamBoundary,p.ssrc)&&Object.keys(this.streamBoundary).length>=8){var retired=Object.keys(this.streamBoundary)[0];if(this.captureGroups[retired]){this.captureGroups[retired].complete=true;this.captureGroups[retired].damaged=true;this.captureGroups[retired].keyframe=false;delete this.captureGroups[retired];}delete this.streamBoundary[retired];}group=this.captureGroups[p.ssrc];if(group&&group.timestamp!==p.timestamp){group.complete=true;group.damaged=true;group.keyframe=false;delete this.captureGroups[p.ssrc];group=null;}
  if(!group){group={timestamp:p.timestamp,complete:false,damaged:false,keyframe:false,first:null,boundary:Object.keys(this.streamBoundary).every(function(k){return this.streamBoundary[k];},this)};this.captureGroups[p.ssrc]=group;}
  if(keyframe(p)&&!group.damaged)group.keyframe=true;this.streamBoundary[p.ssrc]=p.marker;if(p.marker){group.complete=true;delete this.captureGroups[p.ssrc];}
 }
 if(this.queuedBytes+data.length>this.queueLimit){this.dropped++;this.pendingDrops++;this.lastDropUs=atUs;if(group){group.complete=true;group.damaged=true;group.keyframe=false;}this.kick();return false;}
 var item={data:data,type:1,atUs:atUs,group:group,parsed:p};if(group&&!group.first)group.first=item;
 this.queue.push(item);this.queuedBytes+=data.length;this.accepted++;this.latestAt=Math.max(this.latestAt,atUs);this.units.push(p||packet,atUs);this.kick();return true;
};
Recorder.prototype.event=function(event,atUs){
 if(this.stopping||this.stopped||this.error)return false;atUs=atUs==null?this.nowUs():atUs;
 var data;try{data=archive.record(2,atUs,Buffer.from(JSON.stringify(event)));}catch(e){return false;}
 if(this.queuedBytes+data.length>this.queueLimit){this.pendingEvents++;if(event.reason==='rtp-sequence-gap')this.pendingSequenceGaps+=event.packets||0;return false;}
 this.queue.push({data:data,type:2,atUs:atUs,event:event});this.queuedBytes+=data.length;this.latestAt=Math.max(this.latestAt,atUs);this.kick();return true;
};
Recorder.prototype.hasReady=function(){var item=this.queue[0];return !!item&&(this.stopping||!item.group||item.group.complete||item.group.first!==item);};
Recorder.prototype.canDrain=function(){return this.hasReady()||!!(this.syncRequested&&this.current);};
Recorder.prototype.kick=function(){var self=this;if(!this.running&&this.canDrain())this.running=Promise.resolve().then(function(){return self.drain();}).catch(function(e){return self.fault(e);}).then(function(){self.running=null;if(self.canDrain()&&!self.error)self.kick();});};
Recorder.prototype.openSegment=async function(atUs){
 await this.guard.check();await io.safePath(path.dirname(this.root),'directory');await io.ensureDir(this.root);await this.guard.check();
 var id=uuid(),dir=path.join(this.root,id+'.partial'),clockAtUs=this.nowUs(),c=this.clock();
 if(typeof c.iso==='string'&&isFinite(Date.parse(c.iso))&&clockAtUs>=atUs)c=Object.assign({},c,{iso:new Date(Date.parse(c.iso)-(clockAtUs-atUs)/1000).toISOString()});
 c={iso:typeof c.iso==='string'?c.iso:null,source:c.source||'head-unit-system',verified:c.verified===true&&typeof c.iso==='string',utcOffsetMinutes:Number.isFinite(c.utcOffsetMinutes)?c.utcOffsetMinutes:-new Date().getTimezoneOffset()};
 await io.mkdir(dir,448);await io.safePath(dir,'directory');await this.guard.check();var fd=await io.open(path.join(dir,'capture.bvr'),fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW||0),384);
 var m={schemaVersion:1,format:'bvr1',id:id,sessionId:this.sessionId,sequence:++this.sequence,startedAt:c.iso,clock:{source:c.source,verified:c.verified===true,utcOffsetMinutes:c.utcOffsetMinutes},timelineId:this.timelineId,startMonotonicUs:atUs,endMonotonicUs:atUs,durationSeconds:0,bytes:16,packets:0,observedSequenceGaps:0,applicationDroppedPackets:0,stopReason:null,cameraMapping:'unverified',previousId:this.previousId,requiresPrevious:true,complete:false,durabilityIntervalSeconds:1};
 var sources={},prefixNeeded={};
 this.current={id:id,dir:dir,fd:fd,manifest:m,bytes:0,lastSyncUs:atUs,sources:sources,prefixNeeded:prefixNeeded,sourceOverflow:false,decoder:new rtp.AccessUnits(function(unit){if(unit.idr&&Object.prototype.hasOwnProperty.call(sources,unit.ssrc)){sources[unit.ssrc]=true;m.recoveryInfo=m.recoveryInfo||{};m.recoveryInfo[unit.ssrc]={rtpTimestamp:unit.rtpTimestamp,sps:unit.sps.toString('base64'),pps:unit.pps.toString('base64')};}},function(){},{metadataOnly:true})};
 await this.guard.check(fd);await this.write(archive.header());await io.atomicJSON(path.join(dir,'manifest.json'),m);await this.writeEvent({type:'start',id:id,sessionId:this.sessionId,sequence:this.sequence,clock:c},atUs);
 if(this.initialEvents){var initEvents=this.initialEvents(atUs);if(Array.isArray(initEvents)){for(var k=0;k<initEvents.length;k++)await this.writeEvent(initEvents[k],atUs);}}
 this.state='Recording';
};
Recorder.prototype.write=async function(b){var c=this.current;await this.guard.check(c.fd);await io.safePath(c.dir,'directory');if(this.ensureCapacity)await this.ensureCapacity(b.length);await this.guard.check(c.fd);await io.writeAll(c.fd,b);c.bytes+=b.length;if(this.capacityWritten)this.capacityWritten(b.length);};
Recorder.prototype.writeEvent=async function(event,atUs){await this.write(archive.record(2,atUs,Buffer.from(JSON.stringify(event))));if(event.reason==='rtp-sequence-gap')this.current.manifest.observedSequenceGaps+=event.packets||0;};
Recorder.prototype.flushLoss=async function(){
 if(this.pendingDrops){var count=this.pendingDrops;this.pendingDrops=0;await this.writeEvent({type:'discontinuity',reason:'queue-overflow',packets:count},this.lastDropUs);this.current.manifest.applicationDroppedPackets+=count;}
 if(this.pendingSequenceGaps){var gaps=this.pendingSequenceGaps;this.pendingSequenceGaps=0;await this.writeEvent({type:'discontinuity',reason:'rtp-sequence-gap',packets:gaps,coalesced:true},this.latestAt);}
 if(this.pendingEvents){var n=this.pendingEvents;this.pendingEvents=0;await this.writeEvent({type:'discontinuity',reason:'event-queue-overflow',events:n},this.latestAt);}
};
Recorder.prototype.shouldRotate=function(item,c,priorPackets,priorBytes){var g=item.group;if(item.type!==1||!g||g.first!==item||!g.boundary||!(c.manifest.packets+(priorPackets||0)))return false;var elapsed=item.atUs-c.manifest.startMonotonicUs;return (elapsed>=this.segmentUs&&(g.keyframe||elapsed>=this.segmentUs+this.overrunUs))||c.bytes+(priorBytes||0)+item.data.length>=this.maxSegmentBytes;};
Recorder.prototype.drain=async function(){
 while(this.canDrain()&&!this.error){if(this.syncRequested&&this.current){this.syncRequested=false;await this.guard.check(this.current.fd);await io.fsync(this.current.fd);this.current.lastSyncUs=this.nowUs();}if(!this.hasReady())return;var item=this.queue[0];if(!this.current)await this.openSegment(item.atUs);var c=this.current;
  if(this.shouldRotate(item,c)){await this.flushLoss();await this.finish('segment',item.atUs);await this.openSegment(item.atUs);c=this.current;}
  var batch=[],bytes=0,priorPackets=0;
  for(var i=0;i<this.queue.length&&i<BATCH_RECORDS;i++){var next=this.queue[i];if(next.group&&next.group.first===next&&!next.group.complete&&!this.stopping)break;if(i&&this.shouldRotate(next,c,priorPackets,bytes))break;if(bytes&&bytes+next.data.length>BATCH_BYTES)break;if(c.bytes+bytes+next.data.length>=this.maxSegmentBytes){var cap=Error('Access unit exceeds segment storage limit');cap.code='EFBIG';throw cap;}batch.push(next);bytes+=next.data.length;if(next.type===1)priorPackets++;}
  if(!batch.length)return;
  await this.write(Buffer.concat(batch.map(function(x){return x.data;}),bytes));
  if(priorPackets){this.writtenVideoPackets+=priorPackets;this.lastVideoWriteUs=this.nowUs();}
  for(var j=0;j<batch.length;j++){var written=batch[j];c.manifest.endMonotonicUs=Math.max(c.manifest.endMonotonicUs,written.atUs);if(written.type===1){c.manifest.packets++;var parsed=written.parsed;if(parsed){var stream=parsed.ssrc;if(!Object.prototype.hasOwnProperty.call(c.sources,stream)){if(Object.keys(c.sources).length>=8)c.sourceOverflow=true;else c.sources[stream]=false;}}else c.sourceOverflow=true;// A later recovery IDR cannot make an already retained dependent prefix standalone.
    if(parsed&&Object.prototype.hasOwnProperty.call(c.sources,parsed.ssrc)&&!c.sources[parsed.ssrc]&&rtp.opensPredicted(parsed.payload))c.prefixNeeded[parsed.ssrc]=true;
    c.decoder.push(parsed||written.data.slice(24),written.atUs);c.manifest.requiresPrevious=Object.keys(c.prefixNeeded).length>0||c.sourceOverflow||!Object.keys(c.sources).length||Object.keys(c.sources).some(function(k){return !c.sources[k];});}else if(written.event&&written.event.reason==='rtp-sequence-gap')c.manifest.observedSequenceGaps+=written.event.packets||0;}
  this.queue.splice(0,batch.length);this.queuedBytes-=bytes;await this.flushLoss();var last=batch[batch.length-1].atUs,syncLimit=this.queuedBytes>(this.queueLimit>>2)?SYNC_BUSY_US:SYNC_IDLE_US;if(last-c.lastSyncUs>=syncLimit){await this.guard.check(c.fd);await io.fsync(c.fd);c.lastSyncUs=last;}
 }
};
Recorder.prototype.finish=async function(reason,atUs){
 if(!this.current)return;var c=this.current,m=c.manifest;if(reason==='segment')this.predecessorLease.protect(c.id);await this.guard.check(c.fd);await this.writeEvent({type:'end',reason:reason},atUs);await io.fsync(c.fd);await io.close(c.fd);c.fd=null;
 m.endMonotonicUs=Math.max(m.endMonotonicUs,atUs);m.durationSeconds=Math.max(0,(m.endMonotonicUs-m.startMonotonicUs)/1000000);m.bytes=c.bytes;m.stopReason=reason;m.complete=true;
 var self=this;async function publish(){if(self.hornLocks)self.hornLocks.apply(m);await self.guard.check();await io.atomicJSON(path.join(c.dir,'manifest.json'),m);await io.syncDir(c.dir);await self.guard.check();await io.rename(c.dir,path.join(self.root,c.id));await io.syncDir(self.root);self.previousId=c.id;self.current=null;if(self.hornLocks&&m.locked===true&&m.hornLockRevision>0)self.hornLocks.pending=true;}
 if(this.hornLocks)await this.hornLocks.library.lock(publish);else await publish();
};
Recorder.prototype.fault=async function(e){clearInterval(this.syncTimer);this.error=String(e&&e.message||e);this.state=e&&e.code==='ENOSPC'?'Storage full':'Drive unavailable';this.queue=[];this.queuedBytes=0;if(this.current&&this.current.fd!=null){try{await io.close(this.current.fd);}catch(ignore){}this.current.fd=null;}};
Recorder.prototype.stop=async function(reason){
 if(this.stopped)return;if(this.stopPromise)return this.stopPromise;this.units.flush();this.stopping=true;clearInterval(this.syncTimer);Object.keys(this.captureGroups).forEach(function(k){this.captureGroups[k].complete=true;},this);this.kick();var self=this;
 this.stopPromise=(async function(){while(self.running)await self.running;if(!self.error&&self.current){try{await self.flushLoss();await self.finish(reason||'stopped',Math.max(self.latestAt,self.nowUs()));}catch(e){await self.fault(e);}}self.predecessorLease.release();self.stopped=true;if(!self.error)self.state='Stopped';})();return this.stopPromise;
};
// Recovery reads one bounded record at a time, never loads a full archive into RAM.
Recorder.recover=async function(root,guard){
 await guard.check();await io.safePath(root,'directory');await require('./library').Library.cleanupTrash(root,guard);var hornWindows=await require('./horn-lock').load(root),names=await io.readdir(root),recovered=[];
 for(var i=0;i<names.length;i++){var name=names[i];if(!name.endsWith('.partial')||!UUID.test(name.slice(0,-8)))continue;var id=name.slice(0,-8),dir=path.join(root,name),fd=null;
  try{await guard.check();await io.safePath(dir,'directory');var file=path.join(dir,'capture.bvr');await io.safePath(file,'file');fd=await io.open(file,fs.constants.O_RDWR|(fs.constants.O_NOFOLLOW||0));await guard.check(fd);var head=await io.readAt(fd,16,0);if(archive.checkHeader(head))throw Error('Invalid partial header');var off=16,first=null,last=0,packets=0,err=null;
   for(;;){await guard.check(fd);var h=await io.readAt(fd,24,off);if(!h.length)break;if(h.length<24)break;var r;try{r=archive.recordHeader(h);}catch(e){err=e.message;break;}var payload=await io.readAt(fd,r.payloadBytes,off+24);if(payload.length!==r.payloadBytes)break;if(archive.crc32(payload)!==r.crc){err='CRC mismatch';break;}if(first===null)first=r.atUs;last=Math.max(last,r.atUs);if(r.type===1)packets++;off+=24+r.payloadBytes;}
   await guard.check(fd);await io.ftruncate(fd,off);await io.fsync(fd);await io.close(fd);fd=null;
   var m={};try{var st=await io.safePath(path.join(dir,'manifest.json'),'file');if(st.size<=1048576)m=JSON.parse(await io.readFile(path.join(dir,'manifest.json'),'utf8'));}catch(ignore){}
   m.schemaVersion=1;m.format='bvr1';m.id=id;m.sessionId=m.sessionId||uuid();m.sequence=m.sequence||0;m.startedAt=m.startedAt||null;m.clock=m.clock||{source:'head-unit-system',verified:false,utcOffsetMinutes:null};if(!m.clock.iso)m.clock.verified=false;m.startMonotonicUs=first===null?0:first;m.endMonotonicUs=last;m.durationSeconds=Math.max(0,(last-m.startMonotonicUs)/1000000);m.bytes=off;m.packets=packets;m.observedSequenceGaps=m.observedSequenceGaps||0;m.applicationDroppedPackets=m.applicationDroppedPackets||0;m.stopReason='recovered-tail';m.cameraMapping='unverified';m.requiresPrevious=m.requiresPrevious!==false;m.previousId=m.previousId||null;m.complete=false;if(err)m.recoveryError=err;
   require('./horn-lock').apply(m,hornWindows);await guard.check();await io.atomicJSON(path.join(dir,'manifest.json'),m);await io.syncDir(dir);await guard.check();await io.rename(dir,path.join(root,id));await io.syncDir(root);recovered.push(m);
  }catch(e){if(fd!=null)try{await io.close(fd);}catch(ignore){}if(e.code==='ENODEV'||e.code==='ENOSPC')throw e;}
 }
 return recovered;
};
module.exports={Recorder:Recorder,nowUs:nowUs,clock:clock,uuid:uuid};
