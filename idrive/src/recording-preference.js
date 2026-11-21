"use strict";
var fs=require('fs'),path=require('path'),crypto=require('crypto');
var DEFAULT_INTERNAL_LIMIT=4000000000,MAX_INTERNAL_LIMIT=10000000000;
function location(owner){return '/var/opt/bimmervision-recorder/preferences/'+owner;}
function directory(dir,owner){var st=fs.lstatSync(dir);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==owner||(st.mode&511)!==448)throw Error('Unsafe recording preference directory');}
function read(dir,owner){
 try{directory(dir,owner);}catch(e){if(e.code==='ENOENT')return undefined;throw e;}
 var fd=null;
 try{fd=fs.openSync(path.join(dir,'recording-preference.json'),fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));var st=fs.fstatSync(fd);if(!st.isFile()||st.uid!==owner||(st.mode&511)!==384||st.size>1024)throw Error('Unsafe recording preference file');var value=JSON.parse(fs.readFileSync(fd,'utf8'));if(!value||typeof value.continuous!=='boolean')throw Error('Invalid recording preference');return value.continuous;}
 catch(e){if(e.code==='ENOENT')return undefined;throw Error('Recording preference unavailable: '+e.message);}
 finally{if(fd!==null)fs.closeSync(fd);}
}
function readObject(dir,owner){
 try{directory(dir,owner);}catch(e){if(e.code==='ENOENT')return undefined;throw e;}
 var fd=null;try{fd=fs.openSync(path.join(dir,'recording-preference.json'),fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));var st=fs.fstatSync(fd);if(!st.isFile()||st.uid!==owner||(st.mode&511)!==384||st.size>1024)throw Error('Unsafe recording preference file');var value=JSON.parse(fs.readFileSync(fd,'utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid recording preference');return value;}
 catch(e){if(e.code==='ENOENT')return undefined;throw Error('Recording preference unavailable: '+e.message);}
 finally{if(fd!==null)fs.closeSync(fd);}
}
function validInternalLimit(value){return Number.isSafeInteger(value)&&value>=1000000000&&value<=MAX_INTERNAL_LIMIT&&value%1000000000===0;}
function readLimit(dir,owner){var fd=null;try{directory(dir,owner);fd=fs.openSync(path.join(dir,'internal-storage-limit.json'),fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));var st=fs.fstatSync(fd);if(!st.isFile()||st.uid!==owner||(st.mode&511)!==384||st.size>1024)throw Error('Unsafe internal storage limit file');var value=JSON.parse(fs.readFileSync(fd,'utf8'));if(!value||!validInternalLimit(value.limitBytes))throw Error('Invalid internal storage limit');return value.limitBytes;}
 catch(e){if(e.code==='ENOENT')return undefined;throw Error('Internal storage limit unavailable: '+e.message);}
 finally{if(fd!==null)fs.closeSync(fd);}}
function writeLimit(dir,owner,limit){if(!validInternalLimit(limit))throw Error('Invalid internal storage limit');directory(dir,owner);var existing=readLimit(dir,owner);if(existing===limit)return;var file=path.join(dir,'internal-storage-limit.json'),tmp=file+'.tmp-'+crypto.randomBytes(8).toString('hex'),fd=null;
 try{fd=fs.openSync(tmp,'wx',384);fs.writeFileSync(fd,JSON.stringify({limitBytes:limit})+'\n');if(process.getuid()!==owner)fs.fchownSync(fd,owner,owner);fs.fsyncSync(fd);fs.closeSync(fd);fd=null;directory(dir,owner);fs.renameSync(tmp,file);fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}catch(e){if(e.code!=='EINVAL'&&e.code!=='ENOTSUP')throw e;}}
 finally{if(fd!==null)fs.closeSync(fd);try{fs.unlinkSync(tmp);}catch(e){if(e.code!=='ENOENT')throw e;}}
}
function write(dir,owner,continuous,initialize){
 if(typeof continuous!=='boolean')throw Error('Invalid recording preference');
 directory(dir,owner);var current=readObject(dir,owner),existing=current&&current.continuous;if(existing===continuous||initialize&&existing!==undefined)return;
 var value=current||{};value.continuous=continuous;
 var file=path.join(dir,'recording-preference.json'),tmp=file+'.tmp-'+crypto.randomBytes(8).toString('hex'),fd=null;
 try{fd=fs.openSync(tmp,'wx',384);fs.writeFileSync(fd,JSON.stringify(value)+'\n');if(process.getuid()!==owner)fs.fchownSync(fd,owner,owner);fs.fsyncSync(fd);fs.closeSync(fd);fd=null;directory(dir,owner);if(initialize){try{fs.linkSync(tmp,file);}catch(e){if(e.code!=='EEXIST')throw e;}}else fs.renameSync(tmp,file);fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}catch(e){if(e.code!=='EINVAL'&&e.code!=='ENOTSUP')throw e;}}
 finally{if(fd!==null)fs.closeSync(fd);try{fs.unlinkSync(tmp);}catch(e){if(e.code!=='ENOENT')throw e;}}
}
function controls(value){var out={};['continuous','volume','transfer','deleteAll','notificationTest','recordingAction','backupCommand','driveCommand','internalStorageLimitBytes'].forEach(function(k){if(value&&Object.prototype.hasOwnProperty.call(value,k))out[k]=value[k];});return out;}
module.exports={location:location,read:read,write:write,readLimit:readLimit,writeLimit:writeLimit,validInternalLimit:validInternalLimit,DEFAULT_INTERNAL_LIMIT:DEFAULT_INTERNAL_LIMIT,MAX_INTERNAL_LIMIT:MAX_INTERNAL_LIMIT,controls:controls};
