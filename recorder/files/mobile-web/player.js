/**
 * BimmerVision Mobile Video Player & Cockpit HUD Controller
 * Hardware-accelerated decoding via WebCodecs VideoDecoder after complete source download,
 * Bounded Memory Management, Camera Identity Mapping, and Real Telemetry Sync.
 */
function bvFetch(url, options) {
  options = options || {};
  if (typeof window !== 'undefined' && window.BVSourceManager) return window.BVSourceManager.fetch(url,options);
  var headers = Object.assign({}, options.headers || {});
  var bearer = sessionStorage.getItem("bimmervision_bearer");
  if (bearer && !headers.Authorization) headers.Authorization = "Bearer " + bearer;
  return fetch(url, Object.assign({ credentials: "include" }, options, { headers: headers }));
}

class BimmerVisionPlayer {
  static useNativePreview(available, secure, hasDecoder, forced) {
    return available && (forced || !secure || !hasDecoder);
  }
  constructor(canvas, hudElements) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.hud = hudElements;

    this.parser = null;
    this.assembler = null;
    this.accessUnits = [];
    this.manifest = null;
    this.bvrUrl = null;
    this.loadedByteOffset = 0;
    this.totalBytes = 0;
    this.isLoadingChunk = false;

    // Decoder & frame cache (bounded to ~50 frames max)
    this.decoder = null;
    this.decodedFrames = new Map(); // auIndex -> ImageBitmap
    this.lastFrFrame = null;
    this.lastLrFrame = null;

    // Camera pair identity & alignment mapping (Front/Rear vs Left/Right)
    this.cameraMapping = this._loadCameraMapping();

    // Playback state
    this.isPlaying = false;
    this.currentTime = 0;
    this.duration = 0;
    this.currentAuIndex = 0;
    this.speedUnit = "mph"; // or "km/h"
    this.currentSpeedLimit = null;
    this._speedLimitCache = new Map();
    this._lastSpeedLimitLookupCoord = null;
    this.viewMode = "quad"; // "quad", "source", "front", "rear", "left", "right"
    this.sedanSelector = null;
    this.liveMap = null;
    this.rafId = null;
    this.lastFrameWallTime = null;

    // Quad offscreen compositing canvas (1280x960)
    this.quadCanvas = document.createElement("canvas");
    this.quadCanvas.width = 1280;
    this.quadCanvas.height = 960;
    this.quadCtx = this.quadCanvas.getContext("2d", { alpha: false });
    this.quadCtx.fillStyle = "#11141a";
    this.quadCtx.fillRect(0, 0, 1280, 960);

    this._clipEpoch = 0;
    this._decoderEpoch = 0;
    this.playbackState = "idle";
    this.streamComplete = false;
    this.nextDecodeIdx = 0;
  }

  _loadCameraMapping(clipId = null) {
    try {
      const id = clipId || this.activeClipId;
      if (id) {
        const savedClip = localStorage.getItem("bimmervision_mapping_" + id);
        if (savedClip) return JSON.parse(savedClip);
      }
      const saved = localStorage.getItem("bimmervision_camera_mapping");
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return {
      phase0: "frontRear", // "frontRear" or "leftRight"
      phase1: "leftRight", // "leftRight" or "frontRear"
      flipHalves: false    // false: Left=0..640, Right=640..1280; true: inverted
    };
  }

  saveCameraMapping(mapping, clipId = null) {
    this.cameraMapping = Object.assign(this.cameraMapping || {}, mapping);
    const id = clipId || this.activeClipId;
    try {
      localStorage.setItem("bimmervision_camera_mapping", JSON.stringify(this.cameraMapping));
      if (id) {
        localStorage.setItem("bimmervision_mapping_" + id, JSON.stringify(this.cameraMapping));
      }
    } catch (_) {}
    this._renderFrameAtTime(this.currentTime);
  }

  _getCodecString() {
    if (this.assembler && this.assembler.sps && this.assembler.sps.length >= 4) {
      const sps = this.assembler.sps;
      const p = sps[1].toString(16).padStart(2, "0");
      const c = sps[2].toString(16).padStart(2, "0");
      const l = sps[3].toString(16).padStart(2, "0");
      return `avc1.${p}${c}${l}`;
    }
    return "avc1.640028"; // High Profile Level 4.0 fallback for BMW HD
  }

  _updateDebugBanner(extra) {
    const dbg = document.getElementById("debugOutput");
    if (!dbg) return;
    const isVisible = dbg.classList.contains("visible") || (window.showAdvancedDetails === true);
    if (!isVisible) {
      dbg.style.display = "none";
      return;
    }
    dbg.style.display = "block";
    const asm = this.assembler;
    const spsHex = asm && asm.sps ? Array.from(asm.sps.slice(0, 4)).map(b => b.toString(16).padStart(2, "0")).join("") : "none";
    const ppsHex = asm && asm.pps ? Array.from(asm.pps.slice(0, 4)).map(b => b.toString(16).padStart(2, "0")).join("") : "none";
    dbg.textContent = `Decoder: ${this.decoder ? this.decoder.state : 'null'} | Queue: ${this.decoder ? this.decoder.decodeQueueSize : 0} | FramesDecoded: ${this.decodedFrames.size} | AUs: ${this.accessUnits.length} | Codec: ${this._getCodecString()} | SPS: ${spsHex} PPS: ${ppsHex} | Err: ${window.lastWebCodecsError || 'none'} ${extra || ''}`;
  }

  _setState(state, message = '') {
    if (this.manifest && !this.streamComplete && state !== 'error' && state !== 'idle' && state !== 'loading') return;
    this.playbackState = state;
    if (this.onStateChange) this.onStateChange({state, message, time: this.currentTime, duration: this.duration, loaded: this.loadedByteOffset, total: this.totalBytes, download: this.downloadStats ? {...this.downloadStats} : null});
  }

  _fail(error) {
    this.pause(); this._activeStreamAbort?.abort(); this.loadError = error instanceof Error ? error : new Error(String(error));
    this._setState('error', this.loadError.message);
  }

  _initDecoder() {
    const epoch = ++this._decoderEpoch;
    this._pendingFrames = new Set();
    this._decoderFlushPromise=null;
    this._decoderMissingFrames=new Set();
    const bitmapJobs=new Set();this._decoderOutputJobs=bitmapJobs;
    if (this.decoder && this.decoder.state !== 'closed') this.decoder.close();
    if (typeof VideoDecoder === 'undefined') return;
    const decoder = new VideoDecoder({
      output: frame => {
        const index = frame.timestamp;
        if (epoch !== this._decoderEpoch || index < this.currentAuIndex - 4) { if (epoch === this._decoderEpoch) this._pendingFrames.delete(index); frame.close(); return; }
        const job=createImageBitmap(frame).then(bitmap => {
          if (epoch !== this._decoderEpoch) { bitmap.close(); return; }
          const old = this.decodedFrames.get(index); if (old) old.close();
          this.decodedFrames.set(index, bitmap);
          this._pendingFrames.delete(index);
          this._evictFrames();
          this._renderFrameAtTime(this.currentTime);
          if (this._hasFramesAt(this.currentTime)) this._setState(this.isPlaying ? 'playing' : 'paused');
        }).catch(e => { if (epoch === this._decoderEpoch) this._fail(e); }).finally(() => {frame.close();bitmapJobs.delete(job);});
        bitmapJobs.add(job);
      },
      error: e => { if (epoch === this._decoderEpoch) this._fail(new Error('This recording could not be decoded. Retry or use the computer preview server. ' + e.message)); }
    });
    this.decoder = decoder;
    decoder.addEventListener('dequeue', () => {
      if (epoch !== this._decoderEpoch || this._decodeScheduled) return;
      this._decodeScheduled = true;
      setTimeout(() => { this._decodeScheduled = false; if (epoch === this._decoderEpoch) this._decodeAhead(); }, 0);
    });
    const config = {codec: this._getCodecString(), optimizeForLatency: true};
    if (this.assembler) config.description = RtpH264Assembler.makeAvcC(this.assembler.sps, this.assembler.pps);
    decoder.configure(config);
  }

  cancelLoad() {
    ++this._clipEpoch; ++this._decoderEpoch;
    this.drivingView?.reset();
    this.pause();
    this._speedLimitAbort?.abort(); this._speedLimitAbort=null; this._speedLimitPending=null;
    this.currentSpeedLimit=null; this._speedLimitLocationKey=null; this._lastSpeedLimitLookupCoord=null;
    this._activeStreamAbort?.abort();
    if (this.decoder && this.decoder.state !== 'closed') this.decoder.close();
    this.decoder = null;
    if (this._nativeVideo) { this._nativeVideo.pause(); this._nativeVideo.removeAttribute('src'); this._nativeVideo.load(); this._nativeVideo.remove(); this._nativeVideo = null; }
    this._clearFrameCache(); this.lastFrFrame = null; this.lastLrFrame = null;
    if (this._nativeMediaUrl) { URL.revokeObjectURL(this._nativeMediaUrl); this._nativeMediaUrl=null; }
    this.streamPromise=null; this.streamComplete=false;
    this.manifest = null; this.parser = null; this.nativeInfo = null;
    this._updateRecordedView(null);
  }

  // Bound each network operation by inactivity, and release aborted readers on clip changes.
  async _loadOperation(operation, signal, timeoutMs = this.loadTimeoutMs || 45000) {
    if (signal.aborted) throw new DOMException('Cancelled','AbortError');
    let timer, aborted;
    try {
      return await Promise.race([operation, new Promise((_, reject) => {
        aborted=()=>reject(new DOMException('Cancelled','AbortError'));
        signal.addEventListener('abort',aborted,{once:true});
        timer=setTimeout(()=>{
          reject(new Error('The recording connection stopped responding. Check the connection and retry.'));
          if (this._activeStreamAbort?.signal === signal) this._activeStreamAbort.abort();
        },timeoutMs);
      })]);
    } finally { clearTimeout(timer); signal.removeEventListener('abort',aborted); }
  }

  async _downloadRecording(url, signal, onChunk, expectedBytes = 0) {
    const startedAt=performance.now();
    const stats=this.downloadStats={bytes:0,elapsedMs:0,receiveWaitMs:0,processingMs:0,bytesPerSecond:0};
    const response=await this._loadOperation(bvFetch(url,{signal}),signal);
    stats.receiveWaitMs=performance.now()-startedAt;
    if (!response.ok) throw new Error('Recording download unavailable: HTTP '+response.status);
    this.totalBytes=Number(response.headers.get('Content-Length')) || expectedBytes || 0;
    this.loadedByteOffset=0;
    const sourceKind=window.BVSourceManager?.source?.kind;
    const loadingText=sourceKind==='usb'?'Reading the complete recording from your USB drive…':sourceKind==='car'?'Reading the complete recording from your car…':'Downloading the complete recording…';
    this._setState('loading',loadingText);
    const reader=response.body.getReader();
    let yieldedAt=performance.now();
    try {
      while (true) {
        const receivingAt=performance.now();
        const {done,value}=await this._loadOperation(reader.read(),signal);
        stats.receiveWaitMs+=performance.now()-receivingAt;
        if (signal.aborted) throw new DOMException('Cancelled','AbortError');
        if (done) break;
        this.loadedByteOffset+=value.byteLength;
        const processingAt=performance.now();
        onChunk(value);
        stats.processingMs+=performance.now()-processingAt;
        stats.bytes=this.loadedByteOffset;stats.elapsedMs=performance.now()-startedAt;
        stats.bytesPerSecond=stats.elapsedMs>0?stats.bytes*1000/stats.elapsedMs:0;
        this._setState('loading',loadingText);
        // Cached streams can contain thousands of immediately ready chunks.
        // Yield once per paint budget, rather than imposing a timer per chunk.
        if(performance.now()-yieldedAt>=16){await new Promise(resolve=>setTimeout(resolve,0));yieldedAt=performance.now();}
      }
      stats.elapsedMs=performance.now()-startedAt;
      stats.bytesPerSecond=stats.elapsedMs>0?stats.bytes*1000/stats.elapsedMs:0;
      if (this.totalBytes && this.loadedByteOffset !== this.totalBytes) throw new Error('The recording download was incomplete. Check the connection and retry.');
    } finally {
      // cancel() also releases an outstanding read on custom/non-fetch streams.
      if(signal.aborted) await reader.cancel().catch(()=>{});
      reader.releaseLock();
    }
  }

  async waitForCompleteRecording(timeoutMs = 45000, onProgress = () => {}) {
    const epoch=this._clipEpoch;
    let lastBytes=this.loadedByteOffset, progressedAt=Date.now();
    while (true) {
      if(epoch!==this._clipEpoch) throw new DOMException('Recording changed. Reopen export for the selected recording.','AbortError');
      if(this.loadError) throw this.loadError;
      if(!this.manifest) throw new Error('Open a recording before exporting.');
      if(this.streamComplete) return;
      if(lastBytes!==this.loadedByteOffset) {lastBytes=this.loadedByteOffset;progressedAt=Date.now();}
      if(Date.now()-progressedAt>=timeoutMs) throw new Error('The recording connection stopped responding. Check the connection and retry.');
      onProgress(this.loadedByteOffset,this.totalBytes);
      await new Promise(resolve=>setTimeout(resolve,25));
    }
  }

  async loadClip(manifestUrl, bvrUrl, clipId = null) {
    const pending=this._loadClip(manifestUrl,bvrUrl,clipId), epoch=this._clipEpoch;
    try { return await pending; }
    catch(error) {
      // A superseded load must never overwrite the next clip's state.
      if(error.name!=='AbortError' && epoch===this._clipEpoch) this._fail(error);
      throw error;
    }
  }

  async _loadClip(manifestUrl, bvrUrl, clipId = null) {
    this.cancelLoad();
    const epoch = this._clipEpoch;
    const controller = new AbortController(); this._activeStreamAbort = controller;
    const signal = controller.signal;
    this.loadError = null; this.streamComplete = false; this.downloadStats=null;
    this.currentTime = 0; this.currentAuIndex = 0; this.nextDecodeIdx = 0;
    this.loadedByteOffset = 0; this.totalBytes = 0; this.accessUnits = [];
    this.bvrUrl = bvrUrl;
    this.drivingView?.reset('Reading recording metadata…');
    this._setState('loading', 'Reading recording information…');
    const response = await this._loadOperation(bvFetch(manifestUrl, {signal}),signal);
    if (!response.ok) throw new Error('Recording information unavailable: HTTP ' + response.status);
    const manifest = await this._loadOperation(response.json(),signal);
    if (signal.aborted || epoch !== this._clipEpoch) throw new DOMException('Cancelled', 'AbortError');
    this.manifest = manifest; this.duration = manifest.durationSeconds || 0;
    this.activeClipId = clipId || (manifest && manifest.id) || null;
    this.cameraMapping = this._loadCameraMapping(this.activeClipId);
    this._updateScrubber();
    if (this.nativeAvailable) return this._loadNative(manifest, epoch, signal);
    if (typeof VideoDecoder === 'undefined') throw new Error('Video playback needs HTTPS on this browser. Open the HTTPS address, or use the computer LAN test server for native playback.');
    this.assembler = new RtpH264Assembler({startMonotonicUs: manifest.startMonotonicUs, recoveryInfo: manifest.recoveryInfo});
    const assembler = this.assembler;
    let released=0;
    const pairLookup=new Map();
    const parser = new StreamingBvrParser({onVideoRecord: r => {
      assembler.process([r], pairLookup);
      while(released<assembler.accessUnits.length) assembler.accessUnits[released++].data=null;
    },onCameraPair: event => {
      if(event.rtpTimestamp!==undefined) pairLookup.set(event.rtpTimestamp,event.pair);
    }});
    this.parser = parser; this.accessUnits = assembler.accessUnits;
    this.streamPromise = this._downloadRecording(bvrUrl,signal,value=>{
      parser.append(value);
    },manifest.bytes).then(()=>{
      if(signal.aborted || epoch!==this._clipEpoch) throw new DOMException('Cancelled','AbortError');
      assembler.flush(pairLookup);
      while(released<assembler.accessUnits.length) assembler.accessUnits[released++].data=null;
      if (!this.accessUnits.length) throw new Error('No usable video frames in this recording.');
      this.streamComplete=true;
      this.drivingView?.load(parser,manifest);
      this._setState('loading','Preparing camera frames…');
      this._initDecoder(); this._decodeAhead();
      if(this.liveMap)this.liveMap.setTrack(parser.getRouteSeries(manifest.startMonotonicUs));
    });
    await this.streamPromise;
    const start = performance.now();
    while (!this._hasFramesAt(0)) {
      if (signal.aborted || epoch !== this._clipEpoch) throw new DOMException('Cancelled','AbortError');
      if (this.loadError) throw this.loadError;
      if (performance.now() - start > 45000) throw new Error('The first video frame is taking too long. Check the connection and retry.');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    this._renderFrameAtTime(0); this._updateTelemetryHud(); this._setState('paused');
  }

  async _loadNative(manifest, epoch, signal) {
    this._setState('loading', 'Preparing a phone-friendly video. The first open may take a moment…');
    const response = await this._loadOperation(bvFetch(`/api/v1/preview/${encodeURIComponent(manifest.id)}`, {signal,timeoutMs:120000}),signal,120000);
    if (!response.ok) { const body = await this._loadOperation(response.json(),signal).catch(() => ({})); throw new Error(body.error || 'Native preview unavailable'); }
    const info = await this._loadOperation(response.json(),signal);
    if (signal.aborted || epoch !== this._clipEpoch) throw new DOMException('Cancelled','AbortError');
    this.nativeInfo = info;
    const parts=[];
    this.streamPromise=this._downloadRecording(info.mediaUrl,signal,chunk=>parts.push(chunk));
    await this.streamPromise;
    if(signal.aborted || epoch!==this._clipEpoch) throw new DOMException('Cancelled','AbortError');
    this._nativeMediaUrl=URL.createObjectURL(new Blob(parts,{type:'video/mp4'}));
    this._setState('loading','Preparing camera frames…');
    this.parser = new StreamingBvrParser({}); this.parser.telemetryRecords = info.telemetry || [];
    this.assembler = null; this.accessUnits = [];
    const video = document.createElement('video'); this._nativeVideo = video;
    video.muted = true; video.playsInline = true; video.preload = 'auto';
    video.setAttribute('playsinline',''); video.setAttribute('aria-hidden','true');
    video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0.001;pointer-events:none;bottom:0;left:0;';
    document.body.appendChild(video);
    this._nativePairs = [0,1].map(() => { const c = document.createElement('canvas'); c.width=1280; c.height=480; return c; });
    const live = () => epoch === this._clipEpoch && !signal.aborted;
    video.addEventListener('waiting', () => { if (live()) this._setState('buffering','Buffering video…'); });
    video.addEventListener('seeking', () => { if (live()) this._setState('buffering','Seeking…'); });
    video.addEventListener('seeked', () => { if (live()) { this.currentTime = video.currentTime; this._renderNativeFrame(); this._updateScrubber(); this._updateTelemetryHud(); this._setState(this.isPlaying ? 'playing' : 'paused'); } });
    video.addEventListener('playing', () => { if (live()) this._setState('playing'); });
    video.addEventListener('ended', () => { if (live()) { this.currentTime=this.duration; this.pause(); this._updateScrubber(); this._setState('ended'); this.onEnded?.(); } });
    video.addEventListener('error', () => { if (live()) this._fail(new Error('The browser could not play this video preview. Please retry.')); });
    await new Promise((resolve,reject) => {
      const timer = setTimeout(() => finish(new Error('Video preview timed out.')), 45000);
      const aborted = () => finish(new DOMException('Cancelled','AbortError'));
      const ready = () => finish(); const failed = () => finish(new Error('Video preview could not be loaded.'));
      const finish = error => { clearTimeout(timer); signal.removeEventListener('abort',aborted); video.removeEventListener('loadeddata',ready); video.removeEventListener('error',failed); error ? reject(error) : resolve(); };
      signal.addEventListener('abort',aborted,{once:true}); video.addEventListener('loadeddata',ready,{once:true}); video.addEventListener('error',failed,{once:true}); video.src=this._nativeMediaUrl; video.load();
    });
    if (!live()) throw new DOMException('Cancelled','AbortError');
    this.duration = Number.isFinite(video.duration) ? video.duration : this.duration;
    this.streamComplete = true;
    this.drivingView?.loadSource(this.bvrUrl,manifest);
    if (this.liveMap) this.liveMap.setTrack(this.parser.getRouteSeries(manifest.startMonotonicUs));
    this._renderNativeFrame(); this._updateScrubber(); this._updateTelemetryHud(); this._setState('paused');
  }

  _renderNativeFrame() {
    const v=this._nativeVideo; if (!v || v.readyState < 2) return false;
    this._nativePairs.forEach((c,i) => c.getContext('2d').drawImage(v,0,i*480,1280,480,0,0,1280,480));
    const p0Fr=this.cameraMapping.phase0 === 'frontRear';
    this.lastFrFrame=this._nativePairs[p0Fr?0:1]; this.lastLrFrame=this._nativePairs[p0Fr?1:0];
    this._drawToCanvas(this.lastFrFrame,this.lastLrFrame); this.liveMap?.setTime(this.currentTime); return true;
  }

  _clearFrameCache() { this.decodedFrames.forEach(b => { try { b.close(); } catch (_) {} }); this.decodedFrames.clear(); }
  _evictFrames() {
    for (const [i,b] of this.decodedFrames) {
      if (i < this.currentAuIndex-6 || i > this.currentAuIndex+32) {
        if (b === this.lastFrFrame) this.lastFrFrame=null;
        if (b === this.lastLrFrame) this.lastLrFrame=null;
        b.close(); this.decodedFrames.delete(i);
      }
    }
  }
  _indexAt(time) {
    let lo=0,hi=this.accessUnits.length-1,best=0;
    while(lo<=hi) { const mid=(lo+hi)>>1; if(this.accessUnits[mid].time<=time) {best=mid;lo=mid+1;} else hi=mid-1; } return best;
  }
  _frameUnavailable(index) { return this.accessUnits[index]?.damaged || this._decoderMissingFrames?.has(index); }
  _hasFramesAt(time) {
    if (!this.accessUnits.length) return false;
    const i=this._indexAt(time);
    if (time > this.accessUnits[this.accessUnits.length-1].time + 0.08 && !this.streamComplete) return false;
    return [i,i > 0 ? i-1 : Math.min(1,this.accessUnits.length-1)].every(index=>this._frameUnavailable(index) || this.decodedFrames.has(index));
  }
  _resetDecoderForSeek(target) {
    this._clearFrameCache(); this.lastFrFrame=null; this.lastLrFrame=null;
    this._initDecoder();
    let start=Math.max(0,target-1); while(start>0 && !this.accessUnits[start].isKeyFrame) start--;
    this.nextDecodeIdx=start; this._decodeAhead();
  }
  _makeChunk(options) { return new EncodedVideoChunk(options); }
  _decodeAhead() {
    const decoder=this.decoder;
    if (!decoder || decoder.state !== 'configured' || this._nativeVideo) return;
    const end=Math.min(this.accessUnits.length,this.currentAuIndex+26);
    while(this.nextDecodeIdx<end && decoder.decodeQueueSize<8) {
      const au=this.accessUnits[this.nextDecodeIdx];
      if (au?.damaged || !au?.avcc?.byteLength) {this.nextDecodeIdx++;continue;}
      try { this._pendingFrames?.add(au.index); decoder.decode(this._makeChunk({type:au.isKeyFrame?'key':'delta',timestamp:au.index,data:au.avcc})); this.nextDecodeIdx++; }
      catch(e) {this._fail(e);break;}
    }
    if(this.streamComplete && this.accessUnits.length && this.nextDecodeIdx>=this.accessUnits.length && !this._decoderFlushPromise && typeof decoder.flush==='function') {
      const epoch=this._decoderEpoch, jobs=this._decoderOutputJobs || new Set(), signal=this._activeStreamAbort?.signal;
      // An empty decode queue does not mean all pictures have been output. AVC
      // decoders can retain trailing pictures until an explicit end-of-stream flush.
      const draining=(async()=>{await decoder.flush();await Promise.allSettled([...jobs]);})();
      this._decoderFlushPromise=(signal?this._loadOperation(draining,signal,15000):draining).then(()=>{
        if(epoch!==this._decoderEpoch)return;
        // Some decoders omit an unrenderable tail picture without an error. Keep
        // its source-time slot unavailable instead of buffering forever at EOF.
        for(const index of this._pendingFrames)this._decoderMissingFrames.add(index);
        this._pendingFrames.clear();
        this._renderFrameAtTime(this.currentTime);
      }).catch(error=>{if(epoch===this._decoderEpoch)this._fail(error);});
    }
    this._evictFrames();
  }
  async play({restartAtEnd=true} = {}) {
    if (this.isPlaying || !this.manifest || !this.streamComplete || this.loadError) return;
    if (restartAtEnd && this.currentTime >= this.duration-0.05) this.seek(0);
    if (this._nativeVideo) {
      try { await this._nativeVideo.play(); } catch (_) { this._setState('paused','Ready. Tap Play to start video.'); return; }
    }
    this.isPlaying=true; this.lastFrameWallTime=performance.now();
    if(this.hud.playBtn) { this.hud.playBtn.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M6 4h4v16H6zm8 0h4v16h-4z"/></svg>'; this.hud.playBtn.setAttribute('aria-label','Pause'); }
    this._setState('playing'); this._tick();
  }
  pause() {
    this.isPlaying=false; this._nativeVideo?.pause();
    if(this.rafId) cancelAnimationFrame(this.rafId); this.rafId=null;
    if(this.hud.playBtn) {this.hud.playBtn.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';this.hud.playBtn.setAttribute('aria-label','Play');}
    if(this.playbackState !== 'loading' && this.playbackState !== 'error') this._setState('paused');
  }
  togglePlay() { if(this.isPlaying) this.pause(); else this.play(); }
  seek(seconds) {
    this.currentTime=Math.max(0,Math.min(this.duration,Number(seconds)||0)); this.lastFrameWallTime=performance.now();
    if(this._nativeVideo) {this._nativeVideo.currentTime=this.currentTime; this._setState('buffering','Seeking…');}
    else if(this.accessUnits.length) {
      this.currentAuIndex=this._indexAt(this.currentTime);
      if(!this._hasFramesAt(this.currentTime)) {
        this._setState('buffering','Preparing this part of the recording…');
        const required=[this.currentAuIndex,Math.max(0,this.currentAuIndex-1)];
        const evicted=required.some(i => i<this.nextDecodeIdx && !this.decodedFrames.has(i) && !this._pendingFrames?.has(i));
        if(evicted) this._resetDecoderForSeek(this.currentAuIndex);
        else this._decodeAhead();
      }
      this._renderFrameAtTime(this.currentTime);
    }
    this._updateScrubber(); this._updateTelemetryHud();
  }
  async seekAndWait(seconds) {
    const clipEpoch=this._clipEpoch, seekEpoch=this._seekEpoch=(this._seekEpoch||0)+1;
    const initialPairTime=this._nativeVideo && Number.isFinite(this.nativeInfo?.firstCompleteFrameTime)?this.nativeInfo.firstCompleteFrameTime:0;
    this.seek(Math.max(Number(seconds)||0,initialPairTime));
    const target=this.currentTime, start=Date.now();
    while (true) {
      if(clipEpoch!==this._clipEpoch || seekEpoch!==this._seekEpoch) throw new DOMException('Cancelled','AbortError');
      if(this.loadError) throw this.loadError;
      if(!this._nativeVideo)this.currentAuIndex=this._indexAt(target);
      const ready=this._nativeVideo ? !this._nativeVideo.seeking && this._nativeVideo.readyState>=2 && Math.abs(this._nativeVideo.currentTime-target)<0.1 : this._hasFramesAt(target);
      if(ready && this._renderFrameAtTime(target)) {
        this._updateScrubber();this._updateTelemetryHud();
        this._setState(this.isPlaying?'playing':'paused');
        return;
      }
      if(Date.now()-start>45000) throw new Error('This part of the video could not be prepared. Please retry.');
      if(!this._nativeVideo)this._decodeAhead();
      await new Promise(resolve=>setTimeout(resolve,25));
    }
  }
  step(direction) {this.pause();this.seek(this.currentTime+direction/30);}
  requiresCameraMappingAt(time) {return !this.parser?.getCameraViewAtTime(time,this.manifest?.startMonotonicUs)?.single;}
  setViewMode(mode) {this.viewMode=mode;this.sedanSelector?.setLayout(mode);this._renderFrameAtTime(this.currentTime);}
  setSpeedUnit(unit) {this.speedUnit=unit;this._updateTelemetryHud();}
  setSedanSelector(selector) {this.sedanSelector=selector;}
  setLiveMap(map) {this.liveMap=map;}

  setDrivingView(view) {this.drivingView=view;}
  _tick() {
    if(!this.isPlaying) return;
    const now=performance.now(),dt=Math.min(0.15,Math.max(0,(now-this.lastFrameWallTime)/1000)); this.lastFrameWallTime=now;
    if(this._nativeVideo) {this.currentTime=this._nativeVideo.currentTime;this._renderNativeFrame();}
    else {
      const candidate=Math.min(this.duration,this.currentTime+dt);
      this.currentAuIndex=this.accessUnits.length?this._indexAt(candidate):0; this._decodeAhead();
      if(this._hasFramesAt(candidate)) {this.currentTime=candidate;this._renderFrameAtTime(candidate);this._setState('playing');}
      else this._setState('buffering','Buffering camera frames…');
      if(this.currentTime>=this.duration) {this.pause();this._updateScrubber();this._setState('ended');this.onEnded?.();return;}
    }
    this._updateScrubber(); this._updateTelemetryHud(); this.rafId=requestAnimationFrame(()=>this._tick());
  }
  _renderFrameAtTime(time) {
    if(this._nativeVideo) return this._renderNativeFrame();
    if(!this.accessUnits.length) return false;
    const index=this._indexAt(time);
    const view=this.parser?.getCameraViewAtTime(time,this.manifest?.startMonotonicUs) || null;
    this._updateRecordedView(view);
    if (view?.single) {
      let frame=null;
      for (let i=index;i>=Math.max(0,index-12);i--) {
        const unit=this.accessUnits[i];
        if (unit.atUs < view.atUs) break;
        if (!this._frameUnavailable(unit.index) && this.decodedFrames.has(unit.index)) {frame=this.decodedFrames.get(unit.index);break;}
      }
      this._drawRecordedView(view,frame);
      this.liveMap?.setTime(time);
      return !!frame || this.accessUnits[index].atUs < view.atUs;
    }
    let b0=null, b1=null, resolved0=false, resolved1=false;
    for (let i = index; i >= Math.max(0, index - 12); i--) {
      const u=this.accessUnits[i], phase=u.phase!==undefined?u.phase:i%2;
      if (view && u.atUs < view.atUs) break;
      if(phase===0 && !resolved0 && (this._frameUnavailable(u.index) || this.decodedFrames.has(u.index))) {b0=this._frameUnavailable(u.index)?null:this.decodedFrames.get(u.index);resolved0=true;}
      if(phase===1 && !resolved1 && (this._frameUnavailable(u.index) || this.decodedFrames.has(u.index))) {b1=this._frameUnavailable(u.index)?null:this.decodedFrames.get(u.index);resolved1=true;}
      if(resolved0 && resolved1)break;
    }
    const p0Fr=this.cameraMapping.phase0==='frontRear';
    if(resolved0)this[p0Fr?'lastFrFrame':'lastLrFrame']=b0;
    if(resolved1)this[p0Fr?'lastLrFrame':'lastFrFrame']=b1;
    if(!resolved0 && !resolved1 && !this.lastFrFrame && !this.lastLrFrame) {
      if (view && this.accessUnits[index].atUs < view.atUs) {this._drawRecordedView(view,null);return true;}
      return false;
    }
    this._drawToCanvas(this.lastFrFrame,this.lastLrFrame); this.liveMap?.setTime(time); return true;
  }

  _updateRecordedView(view) {
    const key=view ? `${view.rawStateHex}/${view.label}/${view.atUs}` : 'legacy';
    if (key===this._recordedViewKey) return;
    this._recordedViewKey=key;
    this.lastFrFrame=null; this.lastLrFrame=null;
    if (this.sedanSelector?.container) this.sedanSelector.container.hidden=!!view?.single;
    this.onCameraViewChange?.(view);
  }

  _drawRecordedView(view,frame) {
    const ctx=this.ctx,cw=this.canvas.width,ch=this.canvas.height;
    ctx.fillStyle='#0a0c10';ctx.fillRect(0,0,cw,ch);
    if (frame) {
      const width=frame.width || 1280,height=frame.height || 480;
      const scale=Math.min(cw/width,ch/height),w=width*scale,h=height*scale;
      ctx.drawImage(frame,(cw-w)/2,(ch-h)/2,w,h);
    }
    this._drawSingleBadge(ctx,view.label.toUpperCase(),cw,ch,Math.max(1,cw/(this.canvas.clientWidth || cw)));
  }

  _drawToCanvas(frBmp, lrBmp) {
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const ctx = this.ctx;

    ctx.fillStyle = "#0a0c10";
    ctx.fillRect(0, 0, cw, ch);

    try {
      // Apply half-swapping if user inverted halves in camera identity
      const flip = this.cameraMapping.flipHalves;
      const h1x = flip ? 640 : 0;
      const h2x = flip ? 0 : 640;

      if (this.viewMode === "quad") {
        const qCtx = this.quadCtx;
        qCtx.fillStyle = "#0a0c10";
        qCtx.fillRect(0, 0, 1280, 960);
        if (frBmp) {
          try {
            qCtx.drawImage(frBmp, h1x, 0, 640, 480, 0, 0, 640, 480);
            qCtx.drawImage(frBmp, h2x, 0, 640, 480, 640, 0, 640, 480);
          } catch (e1) {
            console.warn("Draw frBmp err:", e1);
          }
        }
        if (lrBmp) {
          try {
            qCtx.drawImage(lrBmp, h1x, 0, 640, 480, 0, 480, 640, 480);
            qCtx.drawImage(lrBmp, h2x, 0, 640, 480, 640, 480, 640, 480);
          } catch (e2) {
            console.warn("Draw lrBmp err:", e2);
          }
        }

        this._drawQuadLabels(qCtx);
        ctx.drawImage(this.quadCanvas, 0, 0, cw, ch);

      } else if (this.viewMode === "source") {
        if (frBmp && lrBmp) {
          ctx.drawImage(frBmp, 0, 0, 1280, 480, 0, 0, cw, ch / 2);
          ctx.drawImage(lrBmp, 0, 0, 1280, 480, 0, ch / 2, cw, ch / 2);
          ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, ch / 2);
          ctx.lineTo(cw, ch / 2);
          ctx.stroke();
        } else if (frBmp) {
          ctx.drawImage(frBmp, 0, 0, 1280, 480, 0, 0, cw, ch);
        } else if (lrBmp) {
          ctx.drawImage(lrBmp, 0, 0, 1280, 480, 0, 0, cw, ch);
        }
        this._drawSingleBadge(ctx, "SOURCE · RAW ACCESS UNITS", cw, ch);

      } else if (this.viewMode === "front") {
        if (frBmp) {
          ctx.drawImage(frBmp, h1x, 0, 640, 480, 0, 0, cw, ch);
        }
        this._drawSingleBadge(ctx, "FRONT CAMERA", cw, ch);

      } else if (this.viewMode === "rear") {
        if (frBmp) {
          ctx.drawImage(frBmp, h2x, 0, 640, 480, 0, 0, cw, ch);
        }
        this._drawSingleBadge(ctx, "REAR CAMERA", cw, ch);

      } else if (this.viewMode === "left") {
        if (lrBmp) {
          ctx.drawImage(lrBmp, h1x, 0, 640, 480, 0, 0, cw, ch);
        }
        this._drawSingleBadge(ctx, "LEFT SIDE CAMERA", cw, ch);

      } else if (this.viewMode === "right") {
        if (lrBmp) {
          ctx.drawImage(lrBmp, h2x, 0, 640, 480, 0, 0, cw, ch);
        }
        this._drawSingleBadge(ctx, "RIGHT SIDE CAMERA", cw, ch);
      }
    } catch (drawErr) {
      console.error("Canvas draw error:", drawErr);
      window.lastWebCodecsError = "Draw error: " + (drawErr ? drawErr.message : String(drawErr));
      this._updateDebugBanner();
    }
  }

  /**
   * Helper for Camera Identity dialog: returns current raw source frame
   */
  getCurrentRawFrame(phase = 0) {
    if (this._nativeVideo) {
      const idx = phase === 1 ? 1 : 0;
      const bitmap = (this._nativePairs && this._nativePairs[idx]) || this.lastFrFrame || this.lastLrFrame;
      return {
        bitmap: bitmap,
        auIndex: idx,
        time: this.currentTime,
        rtpTimestamp: "native",
        ssrc: "native",
        isPhase0: idx === 0
      };
    }
    if (!this.accessUnits || this.accessUnits.length === 0) return null;
    const targetPhase=phase===1?1:0,index=this._indexAt(this.currentTime);
    const view=this.parser?.getCameraViewAtTime(this.currentTime,this.manifest?.startMonotonicUs);
    let au=null,bitmap=null;
    for(let i=index;i>=Math.max(0,index-12);i--){
      const candidate=this.accessUnits[i];
      if(view && candidate.atUs<view.atUs) break;
      if((candidate.phase ?? i%2)===targetPhase && !this._frameUnavailable(candidate.index) && this.decodedFrames.has(candidate.index)){au=candidate;bitmap=this.decodedFrames.get(candidate.index);break;}
    }
    if(!au)return null;
    return {
      bitmap: bitmap,
      auIndex: au.index,
      time: au.time,
      rtpTimestamp: au.rtpTimestamp,
      ssrc: au.ssrc,
      isPhase0: targetPhase === 0
    };
  }

  /**
   * Helper for Export Preview: returns mid-recording camera frames and telemetry
   */
  getMidRecordingFrames() {
    const midTime = (this.duration || 0) / 2;
    let telem = null;
    if (this.parser && this.manifest?.startMonotonicUs != null) {
      telem = this.parser.getTelemetryAtTime(midTime, this.manifest.startMonotonicUs);
    }
    let fr = this.lastFrFrame;
    let lr = this.lastLrFrame;

    if (this.accessUnits?.length && this.decodedFrames) {
      const idx = this._indexAt(midTime);
      const even = idx % 2 === 0 ? idx : idx - 1;
      const odd = idx % 2 === 1 ? idx : Math.max(1, idx - 1);
      const b0 = this.decodedFrames.get(even);
      const b1 = this.decodedFrames.get(odd);
      const p0Fr = this.cameraMapping.phase0 === 'frontRear';
      if (b0) { if (p0Fr) fr = b0; else lr = b0; }
      if (b1) { if (p0Fr) lr = b1; else fr = b1; }
    } else if (this._nativePairs) {
      const p0Fr = this.cameraMapping.phase0 === 'frontRear';
      fr = this._nativePairs[p0Fr ? 0 : 1] || fr;
      lr = this._nativePairs[p0Fr ? 1 : 0] || lr;
    }


    return {
      fr: fr,
      lr: lr,
      time: midTime,
      telemetry: telem
    };
  }

  _drawSingleBadge(ctx, label, cw, ch, scale = 1) {
    ctx.save();
    ctx.font = `bold ${14*scale}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
    const textWidth = ctx.measureText(label).width;
    const padX = 14*scale;
    const badgeW = textWidth + padX * 2;
    const badgeH = 30*scale;
    const x = 16*scale;
    const y = 16*scale;

    ctx.fillStyle = "rgba(10, 12, 16, 0.78)";
    ctx.beginPath();
    ctx.roundRect(x, y, badgeW, badgeH, 6*scale);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, x + padX, y + 20*scale);
    ctx.restore();
  }

  _drawQuadLabels(qCtx) {
    qCtx.save();
    qCtx.font = "bold 18px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

    const drawBadge = (text, x, y) => {
      qCtx.fillStyle = "rgba(10, 12, 16, 0.75)";
      qCtx.beginPath();
      qCtx.roundRect(x, y, 90, 28, 6);
      qCtx.fill();
      qCtx.strokeStyle = "rgba(255, 255, 255, 0.15)";
      qCtx.lineWidth = 1;
      qCtx.stroke();
      qCtx.fillStyle = "#ffffff";
      qCtx.fillText(text, x + 14, y + 20);
    };

    drawBadge("FRONT", 16, 16);
    drawBadge("REAR", 656, 16);
    drawBadge("LEFT", 16, 496);
    drawBadge("RIGHT", 656, 496);

    // Subtle divider lines
    qCtx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    qCtx.lineWidth = 2;
    qCtx.beginPath();
    qCtx.moveTo(640, 0);
    qCtx.lineTo(640, 960);
    qCtx.moveTo(0, 480);
    qCtx.lineTo(1280, 480);
    qCtx.stroke();

    qCtx.restore();
  }

  _updateScrubber() {
    this.onTimeUpdate?.(this.currentTime);
    if (this.hud.scrubber) {
      this.hud.scrubber.value = this.currentTime;
      this.hud.scrubber.max = this.duration;
    }
    if (this.hud.timeDisplay) {
      const curStr = this._formatTime(this.currentTime);
      const durStr = this._formatTime(this.duration);
      this.hud.timeDisplay.textContent = `${curStr} / ${durStr}`;
    }
  }

  _updateTelemetryHud() {
    this.drivingView?.setTime(this.currentTime);
    if (!this.parser) return;
    const telem = this.parser.getTelemetryAtTime(this.currentTime, this.manifest ? this.manifest.startMonotonicUs : 0);

    // Speed display
    if (this.hud.speedValue && this.hud.speedUnit) {
      const speed = this.speedUnit === "mph" ? telem.speedMph : telem.speedKph;
      this.hud.speedValue.textContent = this.parser.telemetryRecords.length ? speed : "—";
      this.hud.speedUnit.textContent = this.speedUnit === "mph" ? "MPH" : "KM/H";
    }

    // Speed limit badge
    if (this.hud.speedLimit) {
      const limitVal = telem.speedLimit;
      const limitUnit = telem.speedLimitUnit || "mph";
      if (limitVal != null) {
        let displayLimit = limitVal;
        if (this.speedUnit === "km/h" && limitUnit === "mph") {
          displayLimit = Math.round(limitVal * 1.60934);
        } else if (this.speedUnit === "mph" && limitUnit === "km/h") {
          displayLimit = Math.round(limitVal * 0.621371);
        }
        this.hud.speedLimit.textContent = displayLimit;
      } else {
        this.hud.speedLimit.textContent = "—";
      }
    }

    // Option 3 Brake Pedal Animation
    if (this.hud.brakePedal) {
      const brakeEl = this.hud.brakePedal;
      if (telem.brakePressed) {
        brakeEl.classList.add("pedal-active-brake");
      } else {
        brakeEl.classList.remove("pedal-active-brake");
      }
    }

    // Option 3 Accelerator Pedal Animation
    if (this.hud.gasPedal) {
      const gasEl = this.hud.gasPedal;
      if (telem.gasPressed || telem.acceleratorPercent > 5) {
        gasEl.classList.add("pedal-active-gas");
        const gasRibs = gasEl.querySelectorAll(".gas-rib");
        gasRibs.forEach(rib => rib.style.stroke = "#38D47A");
      } else {
        gasEl.classList.remove("pedal-active-gas");
        const gasRibs = gasEl.querySelectorAll(".gas-rib");
        gasRibs.forEach(rib => rib.style.stroke = "rgba(140, 150, 175, 0.6)");
      }
    }

    // Steering Wheel Rotation
    if (this.hud.wheelFace) {
      const angle = telem.steeringAngleDeg || 0;
      this.hud.wheelFace.style.transform = `rotate(${-angle}deg)`;
      const hornWheel = this.hud.wheelHorn;
      if (hornWheel) {
        hornWheel.style.transform = `rotate(${-angle}deg)`;
        const pressed = telem.hornPressed === true && hornWheel.complete && hornWheel.naturalWidth > 0;
        // Both images stay mounted and decoded; switching visibility avoids a
        // blank frame or a different transform interpolation on each press.
        this.hud.wheelFace.style.visibility = pressed ? 'hidden' : 'visible';
        hornWheel.style.visibility = pressed ? 'visible' : 'hidden';
      }
      if (this.hud.wheelAngleVal) {
        this.hud.wheelAngleVal.textContent = `${Math.round(angle)}°`;
      }
    }

    // Blinkers / Indicators
    if (this.hud.blinkerLeft && this.hud.blinkerRight) {
      const ind = String(telem.indicator || telem.blinker || "off").toLowerCase();
      const isLeft = ind === "left" || ind === "hazard" || ind === "both" || ind.includes("links") || ind === "l";
      const isRight = ind === "right" || ind === "hazard" || ind === "both" || ind.includes("rechts") || ind === "r";

      if (isLeft) {
        this.hud.blinkerLeft.classList.add("blinker-active");
      } else {
        this.hud.blinkerLeft.classList.remove("blinker-active");
      }
      if (isRight) {
        this.hud.blinkerRight.classList.add("blinker-active");
      } else {
        this.hud.blinkerRight.classList.remove("blinker-active");
      }
    }
  }

  _speedLimitFor(telem) {
    if (!telem || !Number.isFinite(telem.latitude) || !Number.isFinite(telem.longitude)) return null;
    const key = `${telem.latitude.toFixed(4)},${telem.longitude.toFixed(4)}`;
    const value=this.currentSpeedLimit;
    if(!value)return null;
    if(value.key===key)return value;
    const points=value.geometry||[],lat=telem.latitude,lon=telem.longitude,c=Math.cos(lat*Math.PI/180);
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i];if(!Number.isFinite(a.lat)||!Number.isFinite(a.lon)||!Number.isFinite(b.lat)||!Number.isFinite(b.lon))continue;
      const x=(a.lon-lon)*111320*c,y=(a.lat-lat)*111320,dx=(b.lon-a.lon)*111320*c,dy=(b.lat-a.lat)*111320,z=dx*dx+dy*dy,t=z?Math.max(0,Math.min(1,-(x*dx+y*dy)/z)):0;
      if(Math.hypot(x+t*dx,y+t*dy)<=12)return value;
    }
    return null;
  }

  _resolveSpeedLimit(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat)>90 || Math.abs(lon)>180 || (lat===0 && lon===0)) {
      this.currentSpeedLimit=null; this._speedLimitLocationKey=null; return Promise.resolve();
    }
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    this._speedLimitLocationKey=key; this._speedLimitPosition={latitude:lat,longitude:lon};
    if (this._speedLimitFor(this._speedLimitPosition)) return Promise.resolve();
    this.currentSpeedLimit=null;
    const cached=this._speedLimitCache.get(key);
    if (cached && Date.now()<cached.until) {this.currentSpeedLimit=cached.value;return Promise.resolve();}
    if (this._speedLimitPending) return this._speedLimitPending;
    const epoch=this._clipEpoch, abort=new AbortController();
    this._speedLimitAbort=abort;
    const timer=setTimeout(()=>abort.abort(),14000);
    const validLimit=data=>data && data.isEstimated!==true && Number.isFinite(data.limit) && data.limit>0 && data.limit<=200 && ['mph','km/h'].includes(data.unit);
    let request;
    request=bvFetch(`/api/v1/speed-limit?lat=${lat}&lon=${lon}`,{signal:abort.signal})
      .then(r=>r.ok?r.json():null).catch(()=>null)
      .then(data=>{
        if(validLimit(data) || abort.signal.aborted || epoch!==this._clipEpoch)return data;
        // Direct fetch in the client deliberately omits recorder bearer headers and cookies.
        return typeof BimmerVisionSpeedLimits!=='undefined'?BimmerVisionSpeedLimits.lookup(lat,lon,abort.signal):null;
      })
      .then(data=>{
        if (epoch!==this._clipEpoch || abort.signal.aborted) return;
        const valid=validLimit(data);
        const value=valid?{limit:data.limit,unit:data.unit,source:data.source||'Map speed limit',geometry:Array.isArray(data.geometry)?data.geometry:[],key}:null;
        this._speedLimitCache.delete(key);
        this._speedLimitCache.set(key,{value,until:Date.now()+(value?3600000:30000)});
        while(this._speedLimitCache.size>1000)this._speedLimitCache.delete(this._speedLimitCache.keys().next().value);
        if(this._speedLimitLocationKey===key){this.currentSpeedLimit=value;this._updateTelemetryHud();}else if(value){const previous=this.currentSpeedLimit;this.currentSpeedLimit=value;if(this._speedLimitFor(this._speedLimitPosition))this._updateTelemetryHud();else this.currentSpeedLimit=previous;}
      }).catch(()=>{}).finally(()=>{clearTimeout(timer);if(this._speedLimitPending===request)this._speedLimitPending=null;if(this._speedLimitAbort===abort)this._speedLimitAbort=null;});
    this._speedLimitPending=request;
    return request;
  }

  _formatTime(seconds) {
    const s = Math.floor(seconds);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m.toString().padStart(2, "0")}:${rem.toString().padStart(2, "0")}`;
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { BimmerVisionPlayer };
}
