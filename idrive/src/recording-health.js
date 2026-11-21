'use strict';
function RecordingHealth(){this.lastWarningMs=-Infinity;this.reset();}
RecordingHealth.prototype.reset=function(){this.retryAt=-Infinity;this.enabled=false;this.enabledSince=null;this.hadHealthy=false;this.unhealthySince=null;this.healthySince=null;this.warned=false;this.lastWrite=null;this.progressAt=-Infinity;this.lastDrops=null;this.backlogSince=null;this.qualityPending=null;this.lastQualityKind=null;this.lastQualityWarningMs=-Infinity;this.qualityRetryAt=-Infinity;};
// Quality alerts have their own cooldown/retry: they must never delay an outage.
RecordingHealth.prototype.quality=function(metrics,now,internal){
 var drops=metrics.applicationDroppedPackets;
 if(Number.isFinite(drops)&&drops>=0){if(drops>(this.lastDrops===null?0:this.lastDrops))this.qualityPending='dropped';this.lastDrops=drops;}
 var slow=Number.isFinite(metrics.queueLimit)&&metrics.queueLimit>0&&Number.isFinite(metrics.queuedBytes)&&metrics.queuedBytes>=metrics.queueLimit/2;
 if(slow){if(this.backlogSince===null)this.backlogSince=now;}else{this.backlogSince=null;if(this.qualityPending==='slow')this.qualityPending=null;}
 if(slow&&now-this.backlogSince>=2000&&!this.qualityPending)this.qualityPending='slow';
 if(!this.qualityPending||now<this.qualityRetryAt||now-this.lastQualityWarningMs<120000)return null;
 this.lastQualityKind=this.qualityPending;this.qualityPending=null;this.lastQualityWarningMs=now;
 return {kind:'degraded',message:'BimmerVision\n'+(this.lastQualityKind==='dropped'?'Recording dropped video.\nCheck recording storage when parked.':internal?'Storage writes are falling behind.\nCheck internal storage when parked.':'USB writes are falling behind.\nUse a faster USB drive.')};
};
RecordingHealth.prototype.update=function(status,intent,now){
 status=status||{};intent=intent||{};
 if(intent.continuous===false){this.reset();return null;}
 if(status.recordingPausedForBackup===true&&status.backup&&status.backup.configured&&status.backup.autoUpload&&status.backup.pauseRecording&&Number.isFinite(status.heartbeatMonotonicUs)&&now*1000>=status.heartbeatMonotonicUs&&now*1000-status.heartbeatMonotonicUs<=5000000){this.enabledSince=now;this.unhealthySince=null;this.healthySince=null;this.warned=false;return null;}
 if(intent.continuous===true&&!this.enabled){this.enabled=true;this.enabledSince=now;}
 if(!this.enabled)return null;
 if(status.setupPending&&!this.hadHealthy){this.enabledSince=now;return null;}
 var metrics=status.metrics||{},heartbeat=status.heartbeatMonotonicUs,write=metrics.lastVideoWriteMonotonicUs;
 var heartbeatAge=now*1000-heartbeat,writeAge=now*1000-write;
 var healthy=status.state==='Recording'&&!!status.activeId&&Number.isFinite(heartbeat)&&heartbeatAge>=0&&heartbeatAge<=5000000&&Number.isFinite(write)&&write>0&&writeAge>=0&&writeAge<3000000;
 if(healthy){
  this.hadHealthy=true;this.unhealthySince=null;
  if(this.healthySince===null)this.healthySince=now;
  if(write!==this.lastWrite){this.lastWrite=write;this.progressAt=now;}
  if(this.warned&&now>=this.retryAt&&now-this.healthySince>=3000&&now-this.progressAt<=1000){this.warned=false;return {kind:'restored',message:'BimmerVision\nRecording restored.\nVideo is being saved again.'};}
  return this.quality(metrics,now,!!(status.drive&&status.drive.internal));
 }
 this.backlogSince=null;
 this.healthySince=null;
 if(this.unhealthySince===null)this.unhealthySince=now;
 var since=this.hadHealthy?this.unhealthySince:this.enabledSince,grace=['Storage full','Drive unavailable','Waiting for USB','Select a USB drive','Waiting for recording storage','Select recording storage','Internal storage unavailable'].indexOf(status.state)>=0?2000:this.hadHealthy?5000:20000;
 if(this.warned||now<this.retryAt||now-since<grace||now-this.lastWarningMs<120000)return null;
 this.warned=true;this.lastWarningMs=now;
 var internal=!!(status.drive&&status.drive.internal),detail=status.state==='Storage full'?(internal?'Internal recording storage is full.\nUnlock clips or raise its limit.':'Recording stopped: USB full.\nFree space when parked.'):status.state==='Drive unavailable'||status.state==='Waiting for USB'||status.state==='Select a USB drive'||status.state==='Waiting for recording storage'||status.state==='Select recording storage'||status.state==='Internal storage unavailable'?'Recording interrupted.\nCheck recording storage when parked.':'Recording interrupted.\nTrying to restore camera video.';
 if(!Number.isFinite(heartbeat)||heartbeatAge>5000000)detail='Recorder not responding.\nCheck BimmerVision when parked.';
 return {kind:'interrupted',message:'BimmerVision\n'+detail};
};
RecordingHealth.prototype.deliveryFailed=function(kind,now){if(kind==='degraded'){this.qualityPending=this.lastQualityKind;this.lastQualityWarningMs=-Infinity;this.qualityRetryAt=now+10000;return;}this.retryAt=now+10000;if(kind==='interrupted'){this.warned=false;this.lastWarningMs=-Infinity;}else if(kind==='restored')this.warned=true;};
module.exports={RecordingHealth:RecordingHealth};
