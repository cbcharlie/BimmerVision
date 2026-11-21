'use strict';
// Stored ZIP entries stream directly to the phone. No clip-sized buffers,
// recompression, temporary USB files, or changes to the source recording.
var fs=require('fs'),io=require('./io'),archive=require('./archive');
var MAX=0xffffffff,CHUNK=32768,table=new Uint32Array(256);
for(var i=0;i<256;i++){var c=i;for(var bit=0;bit<8;bit++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;table[i]=c>>>0;}
function crcPart(crc,b){for(var n=0;n<b.length;n++)crc=table[(crc^b[n])&255]^(crc>>>8);return crc>>>0;}
function Zip(write){this.write=write;this.offset=0;this.entries=[];}
Zip.prototype.send=async function(b){if(this.offset+b.length>MAX)throw Error('Raw ZIP exceeds ZIP32 capacity');await this.write(b);this.offset+=b.length;};
Zip.prototype.entry=async function(name,produce){
 var encoded=Buffer.from(name,'utf8'),offset=this.offset,size=0,crc=0xffffffff,self=this;
 var h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt16LE(0x0808,6);h.writeUInt16LE(33,12);h.writeUInt16LE(encoded.length,26);
 await this.send(Buffer.concat([h,encoded]));
 await produce(async function(b){for(var p=0;p<b.length;p+=CHUNK){var part=b.slice(p,p+CHUNK);size+=part.length;if(size>MAX)throw Error('Raw ZIP entry too large');crc=crcPart(crc,part);await self.send(part);}});
 crc=(crc^0xffffffff)>>>0;var d=Buffer.alloc(16);d.writeUInt32LE(0x08074b50,0);d.writeUInt32LE(crc,4);d.writeUInt32LE(size,8);d.writeUInt32LE(size,12);await this.send(d);
 var central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x0808,8);central.writeUInt16LE(33,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(size,20);central.writeUInt32LE(size,24);central.writeUInt16LE(encoded.length,28);central.writeUInt32LE(offset,42);
 this.entries.push(Buffer.concat([central,encoded]));
};
Zip.prototype.finish=async function(){var start=this.offset;for(var i=0;i<this.entries.length;i++)await this.send(this.entries[i]);var size=this.offset-start,e=Buffer.alloc(22);e.writeUInt32LE(0x06054b50,0);e.writeUInt16LE(this.entries.length,8);e.writeUInt16LE(this.entries.length,10);e.writeUInt32LE(size,12);e.writeUInt32LE(start,16);await this.send(e);};
function RawZip(files,folder){if(!/^BimmerVision-[a-z0-9-]+$/i.test(folder))throw Error('Invalid ZIP folder');this.files=files;this.folder=folder+'/';this.handles=[];this.items=[];}
RawZip.prototype.prepare=async function(){
 var seen={};
 try{
  for(var i=0;i<this.files.length;i++){
   var item=this.files[i];if(!/^(capture\.bvr|manifest\.json|mapping\.json)$/.test(item.name)||seen[item.name])throw Error('Invalid raw recording file');seen[item.name]=true;
   var st=await io.safePath(item.path,'file'),fd=await io.open(item.path,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));this.handles.push(fd);var current=await io.fstat(fd);
   if(!current.isFile()||current.ino!==st.ino||current.dev!==st.dev||current.size!==st.size)throw Error('Recording changed');
   if(item.name!=='capture.bvr'&&current.size>(item.name==='mapping.json'?4096:262144))throw Error('Recording metadata too large');
   var entry={name:item.name,fd:fd,size:current.size};this.items.push(entry);if(item.name==='capture.bvr')this.capture=entry;
  }
  if(!this.capture||!seen['manifest.json'])throw Error('Incomplete raw recording bundle');
  // Each JSONL envelope adds fewer than 64 bytes per >=25-byte BVR record.
  // This deliberately conservative bound rejects oversize clips before HTTP headers.
  var bound=this.capture.size*5+1048576;if(bound>MAX){var e=Error('Raw ZIP too large; copy this recording directly from its storage');e.statusCode=413;throw e;}
  var error=archive.checkHeader(await io.readAt(this.capture.fd,16,0));if(error)throw Error(error);
 }catch(e){await this.close();throw e;}
};
RawZip.prototype.close=async function(){var fds=this.handles;this.handles=[];for(var i=0;i<fds.length;i++)await io.close(fds[i]);};
RawZip.prototype.write=async function(write,check,scanRead){
 var zip=new Zip(write),self=this;check=check||async function(){};scanRead=scanRead||check;
 for(var i=0;i<this.items.length;i++){
  var item=this.items[i];
  await zip.entry(this.folder+item.name,async function(sink){for(var pos=0;pos<item.size;pos+=CHUNK){await check();var b=await io.readAt(item.fd,Math.min(CHUNK,item.size-pos),pos);if(b.length!==Math.min(CHUNK,item.size-pos))throw Error('Recording read interrupted');await sink(b);}});
 }
 await zip.entry(this.folder+'metadata.jsonl',async function(sink){
  var fd=self.capture.fd,size=self.capture.size,pos=16,windowAt=-1,window=Buffer.alloc(0);
  async function read(at,n){
   if(at<windowAt||at+n>windowAt+window.length){await check();windowAt=at;window=await io.readAt(fd,Math.min(Math.max(65536,n),size-at),at);await scanRead(window.length);}
   var out=window.slice(at-windowAt,at-windowAt+n);if(out.length!==n)throw Error('Truncated recording');return out;
  }
  while(pos<size){
   var h=archive.recordHeader(await read(pos,24));if(pos+24+h.payloadBytes>size)throw Error('Truncated recording');
   if(h.type===2){var b=await read(pos+24,h.payloadBytes);if(archive.crc32(b)!==h.crc)throw Error('Metadata CRC mismatch');var event=JSON.parse(b.toString('utf8'));await sink(Buffer.from(JSON.stringify({atMonotonicUs:h.atUs,event:event})+'\n'));}
   pos+=24+h.payloadBytes;
  }
 });
 await zip.entry(this.folder+'README.txt',async function(sink){await sink(Buffer.from('BimmerVision original recording\n\ncapture.bvr is the byte-exact original BVR1 archive: compressed camera RTP video plus all recorded metadata. It is not an MP4. Open it with a compatible BimmerVision viewer. No separate H.264 video is included.\nmanifest.json describes this recording; mapping.json is included when a saved camera mapping exists.\nmetadata.jsonl contains one JSON object per original metadata event, with atMonotonicUs and event. Timestamps are original monotonic microseconds; use manifest.startMonotonicUs for relative time. Raw perception bytes remain base64 alongside their recorded schemas and source identifiers. Missing sensor data is not a negative detection.\n\nFiles on the car were not modified.\n'));});
 await check();await zip.finish();
};
module.exports={RawZip:RawZip};
