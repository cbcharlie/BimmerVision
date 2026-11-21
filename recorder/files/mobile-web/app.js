/**
 * BimmerVision Unified Web App Controller
 * Full Drives Grouping, Dark OSM Maps, Corrected Sedan Diagram, and Drive Playback.
 */
document.addEventListener("DOMContentLoaded", async () => {
  await window.BVSourceManager.ready;
  // Tabs & Views
  const viewRecordings = document.getElementById("viewRecordings");
  const viewPlayback = document.getElementById("viewPlayback");

  // Drive Overview Elements
  const driveListEl = document.getElementById("driveList");
  const driveCountEl = document.getElementById("driveCount");
  const overviewTitle = document.getElementById("overviewTitle");
  const overviewSubtitle = document.getElementById("overviewSubtitle");
  const overviewPlayBtn = document.getElementById("overviewPlayBtn");
  const endpointStartAddr = document.getElementById("endpointStartAddr");
  const endpointStartTime = document.getElementById("endpointStartTime");
  const endpointEndAddr = document.getElementById("endpointEndAddr");
  const endpointEndTime = document.getElementById("endpointEndTime");
  const metricDistance = document.getElementById("metricDistance");
  const metricDuration = document.getElementById("metricDuration");
  const metricTopSpeed = document.getElementById("metricTopSpeed");
  const metricAvgSpeed = document.getElementById("metricAvgSpeed");
  const metricMaxSteering = document.getElementById("metricMaxSteering");
  const metricBrakeEvents = document.getElementById("metricBrakeEvents");
  const overviewBackupBtn = document.getElementById("overviewBackupBtn");
  const driveSegmentsList = document.getElementById("driveSegmentsList");

  // Playback & HUD Elements
  const canvas = document.getElementById("videoCanvas");
  const sedanContainer = document.getElementById("sedanSelectorContainer");
  const openCalibrateBtn = document.getElementById("openCalibrateBtn");
  const advancedDetailsToggle = document.getElementById("advancedDetailsToggle");
  const debugBanner = document.getElementById("debugOutput");
  const videoLoadingModal = document.getElementById("videoLoadingModal");
  const loadingModalStatus = document.getElementById("loadingModalStatus");

  let loadingFocus=null;
  function showLoadingModal(title, text) {
    if (videoLoadingModal) {
      if(videoLoadingModal.style.display!=='flex')loadingFocus=document.activeElement;
      document.getElementById("loadingModalTitle").textContent = title;
      if (loadingModalStatus && text) loadingModalStatus.textContent = text;
      document.querySelector(".app-shell").inert = true;
      videoLoadingModal.style.display = "flex";
      document.getElementById("loadingCancelBtn").focus();
    }
  }

  function hideLoadingModal() {
    if (videoLoadingModal) {
      videoLoadingModal.style.display = "none";
      document.querySelector(".app-shell").inert = false;
      if(loadingFocus?.isConnected && loadingFocus.getClientRects().length)loadingFocus.focus();
      loadingFocus=null;
    }
  }

  if (advancedDetailsToggle && debugBanner) {
    advancedDetailsToggle.addEventListener("change", (e) => {
      window.showAdvancedDetails = e.target.checked;
      if (e.target.checked) {
        debugBanner.classList.add("visible");
        debugBanner.style.display = "block";
        if (player) player._updateDebugBanner();
      } else {
        debugBanner.classList.remove("visible");
        debugBanner.style.display = "none";
      }
    });
  }

  const hudElements = {
    playBtn: document.getElementById("playPauseBtn"),
    scrubber: document.getElementById("scrubBar"),
    timeDisplay: document.getElementById("timecode"),
    speedValue: document.getElementById("hudSpeedVal"),
    speedUnit: document.getElementById("hudSpeedUnit"),
    speedLimit: document.getElementById("hudLimitVal"),
    brakePedal: document.getElementById("brakePedalCard"),
    gasPedal: document.getElementById("gasPedalCard"),
    wheelFace: document.getElementById("wheelFace"),
    wheelHorn: document.getElementById("wheelHorn"),
    wheelAngleVal: document.getElementById("wheelAngleVal"),
    blinkerLeft: document.getElementById("blinkerLeft"),
    blinkerRight: document.getElementById("blinkerRight")
  };

  // 1. Initialize Player & Exporter
  const player = new BimmerVisionPlayer(canvas, hudElements);
  window.player = player;
  const drivingView = new BVDrivingView(document.getElementById('drivingViewPanel'));
  player.setDrivingView(drivingView);
  const exporter = new ClipExporter(player);

  // 2. Initialize Dark OSM Maps
  const overviewMapCanvas = document.getElementById("overviewMapCanvas");
  const playbackMapCanvas = document.getElementById("playbackMapCanvas");

  const overviewMap = new DarkOsmMap(overviewMapCanvas, { fitAll: true });
  const playbackMap = new DarkOsmMap(playbackMapCanvas, { fitAll: false });
  player.setLiveMap(playbackMap);

  const driveIcon = name => {
    const paths={play:'<path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none"/>',overview:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 16v-4m5 4V8m5 8v-6"/>',clips:'<rect x="5" y="3" width="16" height="14" rx="2"/><path d="M17 21H5a2 2 0 0 1-2-2V7m8 0h6m-6 4h6"/>',upload:'<path d="M12 15V3m-4 4 4-4 4 4M4 16v4h16v-4"/>',download:'<path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/>'};
    return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+paths[name]+'</svg>';
  };

  // 3. Initialize Interactive Sedan Camera Selector (All, Source, Front, Rear, Left, Right, Identify)
  let sedanSelector = null;
  if (sedanContainer) {
    sedanSelector = new SedanCameraSelector(
      sedanContainer,
      (view) => {
        player.setViewMode(view);
      },
      () => {
        openIdentifyModal();
      }
    );
    player.setSedanSelector(sedanSelector);
    new BVPlaybackLayout(document.getElementById("viewPlayback"),player);
  }

  // 4. Tab Navigation Controller ('Recordings' and 'Playback')
  function switchTab(tabName) {
    if(tabName==='recordings')window.BVRecordingCache?.clear();
    document.body.dataset.screen=tabName==='recordings'?'library':'playback';
    document.querySelector('.app-menu').open=false;
    window.scrollTo({top:0,behavior:"instant"});
    if (tabName === "recordings") {
      viewRecordings.classList.add("active");
      viewPlayback.classList.remove("active");
      setTimeout(() => {
        overviewMap.handleResize();
        overviewMap.render();
      }, 50);
    } else {
      viewPlayback.classList.add("active");
      viewRecordings.classList.remove("active");
      setTimeout(() => {
        playbackMap.handleResize();
        playbackMap.render();
        player._renderFrameAtTime(player.currentTime);
      }, 50);
    }
  }

  let detectedDrives = [];
  let selectedDrive = null;
  let activeDrive = null, activeClip = null, loadToken = 0, lastOpen = null;
  const recordingNavigation = new BVRecordingNavigation({previous:document.getElementById('skipBackBtn'),next:document.getElementById('skipFwdBtn'),getContext:()=>({drive:activeDrive,clipId:activeClip?.id}),openClip:clip=>playClipInDrive(clip,true)});
  const cameraStore = new CameraStore(apiFetch, localStorage);
  let dragWasPlaying=false, seekToken=0, previewAt=0;
  const timeline = new DriveTimeline(document.getElementById('driveTimeline'), (seg, offset, options={}) => {
    if(options.preview){
      // Keep the ruler movable while dragging. Cross-clip preparation starts on release.
      if(activeClip?.id===seg.clip.id && performance.now()-previewAt>80){previewAt=performance.now();player.seek(offset);}
      return;
    }
    seekTimeline(seg,offset,dragWasPlaying);
  });
  timeline.onDragStart=()=>{dragWasPlaying=player.isPlaying;player.pause();};
  async function seekTimeline(seg,offset,resume){
    if(activeClip?.id!==seg.clip.id){await playClipInDrive(seg.clip,resume,offset);return;}
    const token=++seekToken, clipToken=loadToken;
    lastOpen={clip:activeClip,autoPlay:resume,startAt:offset};
    showLoadingModal('Preparing video','Rendering the selected camera frames…');
    await paintLoading();
    if(token!==seekToken||clipToken!==loadToken)return;
    try{
      await player.seekAndWait(offset);
      if(token!==seekToken||clipToken!==loadToken)return;
      await paintLoading();
      if(token!==seekToken||clipToken!==loadToken)return;
      hideLoadingModal();
      if(resume)await player.play({restartAtEnd:false});
    }catch(error){
      if(token!==seekToken||clipToken!==loadToken||error.name==='AbortError')return;
      document.getElementById('loadingRetryBtn').hidden=false;
      showLoadingModal('Could not prepare video',error.message);
    }
  }
  function paintLoading(){return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));}
  const formatBytes = bytes => bytes >= 1024**3 ? `${(bytes/1024**3).toFixed(1)} GB` : `${Math.round(bytes/1024**2)} MB`;
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const getLockSvg = (isLocked, size = 15) => isLocked
    ? `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" fill="currentColor" fill-opacity="0.2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`
    : `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" fill="currentColor" fill-opacity="0.05"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>`;
  const getTrashSvg = (size = 15) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`;
  document.getElementById('backToDrives').addEventListener('click', () => {viewRecordings.classList.remove('detail-open');document.querySelector('.drives-sidebar').scrollIntoView({block:'start'});});
  document.getElementById('playbackBackBtn').addEventListener('click', () => {player.pause();switchTab('recordings');viewRecordings.classList.remove('detail-open');});
  document.getElementById('libraryRefreshBtn').addEventListener('click', () => location.reload());
  document.getElementById('loadingCancelBtn').addEventListener('click', () => {loadToken++;player.cancelLoad();hideLoadingModal();switchTab('recordings');});
  document.getElementById('loadingRetryBtn').addEventListener('click', () => {if(lastOpen)playClipInDrive(lastOpen.clip,lastOpen.autoPlay,lastOpen.startAt);});
  player.onTimeUpdate = seconds => {
    timeline.update(activeClip?.id,seconds);
    hudElements.scrubber.style.setProperty('--seek-progress',(player.duration>0?Math.max(0,Math.min(100,seconds/player.duration*100)):0)+'%');
    document.getElementById('dockElapsed').textContent=DriveTimeline.format(seconds);
    document.getElementById('dockDuration').textContent=DriveTimeline.format(player.duration);
  };
  player.onCameraViewChange = view => { if(openCalibrateBtn) openCalibrateBtn.disabled=!!view?.single; };
  player.onStateChange = ({state,message,loaded,total,download}) => {
    recordingNavigation.update(state==='loading');
    const status = document.getElementById('playbackStatus');
    status.textContent = message || ({playing:'Playing',paused:'Paused',loading:'Preparing video…',buffering:'Buffering…',ended:'Drive complete',idle:'Choose a recording',error:'Playback unavailable'}[state] || state);
    status.dataset.state=state;
    document.getElementById('playbackProgress').hidden=state!=='buffering';
    if (state === 'loading') { if(message)loadingModalStatus.textContent=message;const verb=window.BVSourceManager.readOnly?'read':'received';const received=total ? `${Math.min(100,Math.round(loaded/total*100))}% ${verb}` : loaded ? `${formatBytes(loaded)} ${verb}` : 'Waiting for recording data…';const rate=download?.elapsedMs>=500&&download.bytesPerSecond>0?' · '+formatBytes(download.bytesPerSecond)+'/s':'';const timing=window.showAdvancedDetails===true&&download?' · Receive wait '+(download.receiveWaitMs/1000).toFixed(1)+'s · Video processing '+(download.processingMs/1000).toFixed(1)+'s':'';document.getElementById('loadingProgress').textContent=received+rate+timing; }
    hudElements.playBtn.disabled=!player.streamComplete||state==='loading'||state==='error';
    if(state==='error' && !videoLoadingModal.style.display.includes('flex')) document.getElementById('playbackRetryBtn').hidden=false;
  };
  document.getElementById('playbackRetryBtn').addEventListener('click',()=>{if(activeClip)playClipInDrive(activeClip,true,player.currentTime);});
  player.onEnded=()=>{
    const index=activeDrive?.segments.findIndex(s=>s.clip.id===activeClip?.id) ?? -1;
    const next=activeDrive?.segments[index+1]; if(next)playClipInDrive(next.clip,true);
  };
  document.addEventListener('visibilitychange',()=>{if(document.hidden)player.pause();});


  async function ensureCarSession() { /* Selected source owns pairing. */ }
  function apiFetch(url,options={}) { return window.BVSourceManager.fetch(url,options); }

  let stopRecordingNotice=null;
  function updateRecordingNotice(){
    stopRecordingNotice?.();stopRecordingNotice=null;
    const nodes=[document.getElementById('recordingDownloadNotice'),document.getElementById('recordingDownloadNoticeLoading')];
    nodes.filter(Boolean).forEach(node=>{node.hidden=true;});
    if(window.BVSourceManager.source.kind==='car')stopRecordingNotice=startRecordingNotice({fetcher:apiFetch,nodes});
  }
  updateRecordingNotice();window.BVSourceManager.subscribe(updateRecordingNotice);

  let rawController=null,rawReadyUrl=null;
  const rawPanel=document.getElementById('rawDownloadPanel'),rawText=document.getElementById('rawDownloadStatus'),rawSave=document.getElementById('rawDownloadSave'),rawCancel=document.getElementById('rawDownloadCancel');
  function clearRaw(){rawController?.abort();rawController=null;if(rawReadyUrl)URL.revokeObjectURL(rawReadyUrl);rawReadyUrl=null;rawSave.hidden=true;rawPanel.hidden=true;}
  window.BVSourceManager.subscribe(clearRaw);window.addEventListener('pagehide',clearRaw);
  rawCancel.addEventListener('click',()=>rawController?.abort());
  document.getElementById('rawDownloadClose').addEventListener('click',clearRaw);
  async function downloadRaw(id){
    if(rawController){rawPanel.hidden=false;return;}
    clearRaw();rawPanel.hidden=false;rawCancel.hidden=false;rawText.textContent='Preparing original recording and metadata…';
    const controller=new AbortController(),generation=window.BVSourceManager.generation;rawController=controller;
    try{
      const result=await BVRawDownload.save({manager:window.BVSourceManager,id,signal:controller.signal,saveFilePicker:typeof window.showSaveFilePicker==='function'?window.showSaveFilePicker.bind(window):null,onProgress:({bytes,total,sourceKind})=>{if(window.BVSourceManager.generation!==generation)return;rawText.textContent=(sourceKind==='usb'?'Building ZIP from your USB drive':'Downloading original ZIP')+' · '+formatBytes(bytes)+(total?' / '+formatBytes(total):'');}});
      if(window.BVSourceManager.generation!==generation)return;
      if(result.mode==='file'){rawText.textContent='Original recording ZIP saved.';}
      else {rawReadyUrl=URL.createObjectURL(result.blob);rawSave.href=rawReadyUrl;rawSave.download=result.fileName;rawSave.hidden=false;rawText.textContent='Original recording ZIP ready. Save it to Files or Downloads.';rawSave.click();}
    }catch(error){if(window.BVSourceManager.generation===generation)rawText.textContent=error.name==='AbortError'?'ZIP download cancelled.':error.message;}
    finally{if(rawController===controller){rawController=null;rawCancel.hidden=true;}}
  }
  document.addEventListener('click',event=>{const link=event.target.closest?.('[data-raw-recording]');if(link){event.preventDefault();downloadRaw(link.dataset.rawRecording);}});

  const releaseChecker=new ReleaseChecker({fetcher:fetch.bind(window),storage:sessionStorage});
  let checkingUpdates=false;
  async function checkForUpdates(force=false){
    if(checkingUpdates)return;
    checkingUpdates=true;
    const versionSource=window.BVSourceManager.source;
    const button=document.getElementById('checkUpdatesBtn'),status=document.getElementById('releaseCheckStatus'),banner=document.getElementById('releaseNotice');
    if(window.BVSourceManager.source.kind!=='car'){button.hidden=true;banner.hidden=true;document.getElementById('installedCarVersion').textContent='USB viewing';status.textContent='The hosted web player updates when you reload this page. Car updates are available through MGU Store.';checkingUpdates=false;return;}
    button.hidden=false;button.disabled=true;status.textContent='Checking GitHub using your device’s internet connection…';
    const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),8000);
    try{
      const response=await apiFetch('/api/v1/version',{signal:abort.signal});
      if(!response.ok)throw new Error('Installed version unavailable.');
      const info=await response.json();
      if(window.BVSourceManager.source!==versionSource)return;
      document.getElementById('installedCarVersion').textContent=info.version||'Unavailable';
      window.BVAppVersion?.setConnected(info.version);
      const result=await releaseChecker.check(info.version,{force});
      if(window.BVSourceManager.source!==versionSource)return;
      if(result.state==='update'){
        status.textContent=`Version ${result.latestVersion} is available. Installed: ${result.currentVersion}.`;
        document.getElementById('releaseNoticeText').textContent=`BimmerVision ${result.latestVersion} is available · installed ${result.currentVersion}`;
        document.getElementById('releaseNoticeLink').href=result.url;
        let dismissed=false;try{dismissed=sessionStorage.getItem('bimmervision_dismissed_release')===result.latestVersion;}catch(_){}
        banner.hidden=dismissed;
        banner.dataset.version=result.latestVersion;
      }else{
        banner.hidden=true;
        status.textContent=result.state==='current'?`No newer stable release found. Installed: ${info.version}.`:`Could not check for updates. ${result.reason||''}`;
      }
    }catch(error){if(window.BVSourceManager.source===versionSource){banner.hidden=true;status.textContent='Could not check for updates. Check your device’s internet connection and try again.';}}
    finally{clearTimeout(timer);checkingUpdates=false;button.disabled=false;if(window.BVSourceManager.source!==versionSource)checkForUpdates(true);}
  }
  document.getElementById('checkUpdatesBtn').addEventListener('click',()=>checkForUpdates(true));
  document.getElementById('dismissReleaseNotice').addEventListener('click',()=>{
    const banner=document.getElementById('releaseNotice');banner.hidden=true;
    try{sessionStorage.setItem('bimmervision_dismissed_release',banner.dataset.version);}catch(_){}
  });
  checkForUpdates();

  // 5. Fetch USB Recordings & Group as Drives
  let libraryLoading=null, librarySignature=null;
  async function loadLibrary({quiet=false,onlyChanged=false}={}) {
  const librarySource=window.BVSourceManager.source;
  if(libraryLoading===librarySource)return;
  libraryLoading=librarySource;
  try {
    const capabilities = await apiFetch('/api/v1/capabilities').then(r=>r.ok?r.json():{}).catch(()=>({}));
    if(window.BVSourceManager.source!==librarySource)return;
    player.nativeAvailable = BimmerVisionPlayer.useNativePreview(capabilities.nativePreview === true, window.isSecureContext, typeof VideoDecoder !== "undefined", new URLSearchParams(location.search).get("playback") === "native");
    await ensureCarSession();
    const res = await apiFetch("/api/v1/recordings");
    if (!res.ok) throw new Error("Could not reach car server API");
    const data = await res.json();
    if(window.BVSourceManager.source!==librarySource)return;
    if(quiet && !viewRecordings.classList.contains('active'))return;
    const rawClips = (data.recordings || []).filter(clip=>clip.complete===true);
    const signature=JSON.stringify(rawClips.map(c=>[c.id,c.locked,c.bytes,c.durationSeconds,c.routeStatus,(c.route||[]).length,c.endpoints]));
    if(onlyChanged && signature===librarySignature)return;
    librarySignature=signature;

    // Group recordings into continuous Drives
    detectedDrives = DriveGrouper.group(rawClips);updateMoreBackupCurrent();
    driveCountEl.textContent = `${detectedDrives.length} drive${detectedDrives.length === 1 ? "" : "s"}`;
    driveListEl.innerHTML = "";

    if (detectedDrives.length === 0) {
      driveListEl.innerHTML = `
        <div style="padding: 24px; text-align: center; color: var(--tesla-muted);">
          ${window.BVSourceManager.source?.kind==='car'?'No recordings found in the car’s recording storage.':'No drives recorded on USB flash drive.'}
        </div>
      `;
      overviewSubtitle.textContent = "No recordings found.";
      document.getElementById('librarySummary').textContent='0 drives · 0 recordings';
      selectedDrive=null;overviewPlayBtn.disabled=true;
      window.BVRecordingBackupAction.update(overviewBackupBtn,null,window.BVSourceManager.source?.kind);
      document.getElementById('overviewPlaceholder').hidden=false;
      return;
    }

    const dateGroups = DriveGrouper.groupByDate(detectedDrives);
    const clipCount = rawClips.length;
    document.getElementById('librarySummary').textContent = `${detectedDrives.length} drive${detectedDrives.length===1?'':'s'} · ${clipCount} recording${clipCount===1?'':'s'} · ${formatBytes(rawClips.reduce((n,c) => n+(c.bytes||0),0))}`;
    document.getElementById('connStatus').textContent = librarySource.kind==='usb'?'USB · view only':librarySource.name;
    dateGroups.forEach(group => {
      const section = document.createElement('section'); section.className = 'date-group';
      const heading = document.createElement('h2'); heading.className = 'date-group-header';
      heading.textContent = `${group.dayOfWeek ? group.dayOfWeek + ', ' : ''}${group.dateLabel}`; section.appendChild(heading);
      group.drives.forEach(drive => {
        const card = document.createElement('article'); card.className = 'drive-card'; card.dataset.id = drive.id;
        const location = drive.endpoints.start.address;
        const isDriveLocked = drive.segments.length > 0 && drive.segments.every(s => s.clip.locked);
        const hasAnyLocked = drive.segments.some(s => s.clip.locked);

        card.innerHTML = `
          <div class="drive-card-header" style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
            <div style="flex:1;">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;">
                <h3 class="drive-departure" style="font-size:15px;font-weight:600;color:#fff;margin:0;">${escapeHtml(drive.startTime || 'Recorded drive')}</h3>
              </div>
              <p class="drive-route-summary" style="margin:0;font-size:12px;color:var(--tesla-muted);display:flex;align-items:center;gap:6px;">
                <span class="route-marker" style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--m-blue);box-shadow:0 0 8px var(--m-blue);"></span>
                ${escapeHtml(location === 'Location unavailable' ? (drive.segments.some(s=>s.clip.routeStatus==='indexing')?'Loading recorded location…':'Location not recorded') : location)}
              </p>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
              <button class="btn-lock-drive ${isDriveLocked ? 'is-locked' : ''}" type="button" title="${isDriveLocked ? 'Drive is locked. Click to unlock entire drive.' : 'Lock entire drive to prevent deletion'}" style="display:flex;align-items:center;background:rgba(255,255,255,0.06);border:1px solid ${isDriveLocked ? 'rgba(245,158,11,0.5)' : 'rgba(255,255,255,0.12)'};border-radius:6px;padding:5px 8px;cursor:pointer;color:${isDriveLocked ? '#f59e0b' : 'var(--tesla-muted)'};transition:all 0.2s ease;">
                ${getLockSvg(isDriveLocked, 14)}
              </button>
              <button class="btn-delete-drive" type="button" title="Delete entire drive" style="display:flex;align-items:center;background:rgba(238,36,64,0.1);border:1px solid rgba(238,36,64,0.3);border-radius:6px;padding:5px 8px;cursor:pointer;color:#EE2440;transition:all 0.2s ease;">
                ${getTrashSvg(14)}
              </button>
              <span class="drive-storage" style="font-size:11px;color:var(--tesla-muted);font-weight:500;padding-left:4px;">${formatBytes(drive.bytes)}</span>
            </div>
          </div>
          <p class="drive-description">${escapeHtml(drive.durationFormatted)} of footage${drive.endpoints.end.time ? ` · Ends ${escapeHtml(drive.endpoints.end.time)}` : ''} · ${drive.segments.length} ${drive.segments.length===1?'recording':'recordings'}</p>
          <div class="drive-card-actions" style="margin-top:10px;display:flex;gap:6px;align-items:center;">
            <button class="drive-play" type="button" aria-label="Play drive from ${escapeHtml(drive.startTime || drive.date)}" title="Play drive" style="display:flex;align-items:center;gap:6px;padding:6px 14px;border-radius:999px;font-size:12px;font-weight:600;">
              ${driveIcon("play")}<span>Play drive</span>
            </button>
            <div class="drive-secondary-actions" style="display:flex;gap:6px;">
              <button class="btn-view-entire-drive" type="button" aria-label="Drive overview" title="Drive overview" style="padding:6px 12px;border-radius:999px;font-size:12px;">${driveIcon("overview")}<span>Overview</span></button>
              <button class="btn-toggle-recordings" type="button" aria-label="Show all ${drive.segments.length} clips" aria-controls="drive-clips-${escapeHtml(drive.id)}" title="Recordings in this drive" aria-expanded="false" style="padding:6px 12px;border-radius:999px;font-size:12px;">${driveIcon("clips")}<span class="drive-clips-label">Show all ${drive.segments.length} clips</span></button>
            </div>
          </div>
          <div id="drive-clips-${escapeHtml(drive.id)}" class="drive-recordings-drawer" hidden></div>
        `;
        card.querySelector('.drive-play').addEventListener('click', () => { selectDrive(drive,card); playClipInDrive(drive.segments[0].clip,true); });
        card.querySelector('.btn-view-entire-drive').addEventListener('click', () => { selectDrive(drive,card); viewRecordings.classList.add('detail-open'); if(window.innerWidth<=760)document.querySelector('.drive-overview-stage').scrollIntoView({block:'start',behavior:'smooth'}); });

        const lockDriveBtn = card.querySelector('.btn-lock-drive');
        if (lockDriveBtn) {
          lockDriveBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const target = !isDriveLocked;
            lockDriveBtn.disabled = true;
            for (const seg of drive.segments) {
              try {
                await apiFetch(`/api/v1/recordings/${seg.clip.id}/lock`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ locked: target })
                });
                seg.clip.locked = target;
              } catch (error) { alert('Could not save lock: '+error.message); break; }
            }
            await loadLibrary();
          });
        }

        const deleteDriveBtn = card.querySelector('.btn-delete-drive');
        if (deleteDriveBtn) {
          deleteDriveBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (hasAnyLocked) {
              alert('This drive contains locked recordings. Please unlock the drive or recordings before deleting.');
              return;
            }
            if (!confirm(`Are you sure you want to delete this drive (${drive.segments.length} recordings)? This action cannot be undone.`)) {
              return;
            }
            deleteDriveBtn.disabled = true;
            for (const seg of drive.segments) {
              try {
                await apiFetch(`/api/v1/recordings/${seg.clip.id}`, { method: 'DELETE' });
              } catch (err) {
                alert(`Failed to delete recording: ${err.message}`);
                break;
              }
            }
            await loadLibrary();
          });
        }

        const toggle = card.querySelector('.btn-toggle-recordings'), drawer=card.querySelector('.drive-recordings-drawer');
        toggle.addEventListener('click', () => { const open=drawer.classList.toggle('open');drawer.hidden=!open;toggle.setAttribute('aria-expanded',String(open));const label=open?'Hide clips':`Show all ${drive.segments.length} clips`;toggle.setAttribute('aria-label',label);toggle.querySelector('.drive-clips-label').textContent=label; });
        drive.segments.forEach((seg,i) => {
          const row = document.createElement('div'); row.className='recording-clip-row';
          row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.05);gap:10px;transition:background 0.2s ease;';
          row.innerHTML=`
            <div class="clip-row-info" style="cursor:pointer;flex:1;">
              <div style="display:flex;align-items:center;gap:6px;">
                <strong style="color:#fff;font-size:12px;">Clip ${i+1}</strong>
                <span style="color:var(--tesla-muted);font-size:11px;">· ${DriveTimeline.format(seg.offset)} into drive</span>
              </div>
              <small style="display:block;color:var(--tesla-muted);font-size:11px;margin-top:2px;">${DriveTimeline.format(seg.clip.durationSeconds)} · ${formatBytes(seg.clip.bytes||0)}</small>
            </div>
            <div class="clip-row-actions" style="display:flex;align-items:center;gap:6px;">
              <a class="clip-row-raw" href="#" data-raw-recording="${seg.clip.id}" download aria-label="Download original Clip ${i+1} and metadata as ZIP" title="Download original BVR recording and metadata">${driveIcon("download")}<span>Original ZIP</span></a>
              <button class="clip-row-raw" type="button" data-backup-recording="${seg.clip.id}" aria-label="Send to Remote Backup — Clip ${i+1}" title="Send to Remote Backup using your phone">${driveIcon("upload")}<span>Send to Remote Backup</span></button>
              <button class="btn-lock-clip" type="button" title="${seg.clip.locked ? 'Recording is locked. Tap to unlock.' : 'Lock recording to prevent deletion'}" style="display:flex;align-items:center;background:rgba(255,255,255,0.06);border:1px solid ${seg.clip.locked ? 'rgba(245,158,11,0.5)' : 'rgba(255,255,255,0.12)'};border-radius:6px;padding:4px 8px;cursor:pointer;color:${seg.clip.locked ? '#f59e0b' : 'var(--tesla-muted)'};transition:all 0.2s ease;">
                ${getLockSvg(seg.clip.locked, 13)}
              </button>
              <button class="btn-delete-clip" type="button" title="Delete recording" style="display:flex;align-items:center;background:rgba(238,36,64,0.1);border:1px solid rgba(238,36,64,0.3);border-radius:6px;padding:4px 8px;cursor:pointer;color:#EE2440;transition:all 0.2s ease;">
                ${getTrashSvg(13)}
              </button>
              <button class="clip-row-play" type="button" aria-label="Play recording ${i+1}" title="Play recording" style="display:flex;align-items:center;gap:4px;background:rgba(61,168,242,0.12);border:1px solid rgba(61,168,242,0.25);border-radius:6px;padding:4px 8px;color:var(--m-blue);cursor:pointer;font-size:11px;">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="m8 5 11 7-11 7z"/></svg><span>Play</span>
              </button>
            </div>
          `;
          row.querySelector('.clip-row-info').addEventListener('click',()=>{selectDrive(drive,card);playClipInDrive(seg.clip,true);});
          row.querySelector('.clip-row-play').addEventListener('click',()=>{selectDrive(drive,card);playClipInDrive(seg.clip,true);});

          const lockClipBtn = row.querySelector('.btn-lock-clip');
          lockClipBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const target = !seg.clip.locked;
            lockClipBtn.disabled = true;
            try {
              await apiFetch(`/api/v1/recordings/${seg.clip.id}/lock`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ locked: target })
              });
              seg.clip.locked = target;
              await loadLibrary();
            } catch (err) {
              alert('Could not update lock status.');
              lockClipBtn.disabled = false;
            }
          });

          const delClipBtn = row.querySelector('.btn-delete-clip');
          delClipBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (seg.clip.locked) {
              alert('This recording is locked. You must first unlock the recording before it can be deleted.');
              return;
            }
            if (!confirm(`Are you sure you want to delete Clip ${i+1}? This action cannot be undone.`)) return;
            delClipBtn.disabled = true;
            try {
              const res = await apiFetch(`/api/v1/recordings/${seg.clip.id}`, { method: 'DELETE' });
              if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                alert(data.error || 'Failed to delete recording.');
                delClipBtn.disabled = false;
                return;
              }
              await loadLibrary();
            } catch (err) {
              alert(`Failed to delete: ${err.message}`);
              delClipBtn.disabled = false;
            }
          });

          drawer.appendChild(row);
        });
        section.appendChild(card);
      });driveListEl.appendChild(section);
    });
    if(selectedDrive){const refreshed=detectedDrives.find(d=>d.id===selectedDrive.id);if(refreshed)selectDrive(refreshed,[...document.querySelectorAll(".drive-card")].find(card=>card.dataset.id===refreshed.id));else {selectedDrive=null;window.BVRecordingBackupAction.update(overviewBackupBtn,null,window.BVSourceManager.source?.kind);}}
    if(activeDrive){const refreshed=detectedDrives.find(d=>d.id===activeDrive.id);if(refreshed){activeDrive=refreshed;timeline.setDrive(refreshed);timeline.update(activeClip?.id,player.currentTime);recordingNavigation.update();}}
  } catch (err) {
    if(quiet)return;
    console.error("Failed to load recordings:", err);
    driveCountEl.textContent = "Offline";
    driveListEl.innerHTML = `
      <div style="padding: 20px; text-align: center; color: var(--m-red);">
        Could not load your drives. ${escapeHtml(err.message)}
      </div>
    `;
  } finally {if(libraryLoading===librarySource)libraryLoading=null;}
  }
  window.BVSourceManager.subscribe(()=>{
    loadToken++;player.cancelLoad();hideLoadingModal();
    activeClip=null;activeDrive=null;selectedDrive=null;detectedDrives=[];librarySignature=null;updateMoreBackupCurrent();
    window.BVRecordingBackupAction.update(overviewBackupBtn,null,window.BVSourceManager.source?.kind);
    recordingNavigation.update(false);
    document.getElementById('exportModal').classList.remove('open');document.getElementById('identifyModal').classList.remove('open');
    switchTab('recordings');loadLibrary();checkForUpdates(true);
  });
  window.addEventListener('bimmervision:library-updated',()=>loadLibrary({quiet:true,onlyChanged:true}));
  await loadLibrary();
  startCatalogRefresh(window,()=>!document.hidden && viewRecordings.classList.contains('active') && !document.querySelector('.modal-backdrop.open') && videoLoadingModal.style.display!=='flex',()=>loadLibrary({quiet:true,onlyChanged:true}));


  function selectDrive(drive, cardEl) {
    document.querySelectorAll(".drive-card").forEach((c) => c.classList.remove("active"));
    if (cardEl) cardEl.classList.add("active");

    selectedDrive = drive;
    window.BVRecordingBackupAction.update(overviewBackupBtn,drive,window.BVSourceManager.source?.kind==='car'?'car':null);
    overviewPlayBtn.disabled=false;
    document.getElementById('overviewPlaceholder').hidden=true;

    const isDriveLocked = drive.segments.length > 0 && drive.segments.every(s => s.clip.locked);
    const overviewLockBtn = document.getElementById('overviewLockBtn');
    const overviewLockIcon = document.getElementById('overviewLockIcon');
    const overviewLockLabel = document.getElementById('overviewLockLabel');
    const overviewDeleteBtn = document.getElementById('overviewDeleteBtn');
    if (overviewLockBtn) {
      overviewLockBtn.disabled = false;
      if (overviewLockLabel) overviewLockLabel.textContent = isDriveLocked ? 'Unlock Drive' : 'Lock Drive';
      if (overviewLockIcon) overviewLockIcon.innerHTML = getLockSvg(isDriveLocked, 15);
    }
    if (overviewDeleteBtn) {
      overviewDeleteBtn.disabled = false;
    }

    // Populate Overview
    overviewTitle.textContent = drive.title;
    const sizeMb = (drive.bytes / (1024 * 1024)).toFixed(1) + " MB";
    overviewSubtitle.textContent = `${drive.durationFormatted} · ${drive.segments.length} recordings · ${formatBytes(drive.bytes)}`;

    endpointStartAddr.textContent = drive.endpoints.start.address;
    endpointStartTime.textContent = drive.endpoints.start.time ? `Departed ${drive.endpoints.start.time}` : drive.endpoints.start.coords;

    endpointEndAddr.textContent = drive.endpoints.end.address;
    endpointEndTime.textContent = drive.endpoints.end.time ? `Arrived ${drive.endpoints.end.time}` : drive.endpoints.end.coords;

    // Update Overview Map
    overviewMap.emptyMessage=drive.segments.some(s=>s.clip.routeStatus==='indexing')?'Loading recorded location…':'Location was not recorded';
    overviewMap.setTrack(drive.route);

    // Update Live Tracking Map track
    if (!activeDrive) playbackMap.setTrack(drive.route);

    // Update Metrics
    updateMetricsDisplay(drive);

    // List segments
    driveSegmentsList.innerHTML = "";
    drive.segments.forEach((seg, sIdx) => {
      const item = document.createElement("div");
      item.className = "segment-item";
      item.style.cssText = "display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.05);gap:10px;";
      const sDur = Math.round(seg.clip.durationSeconds || 4);

      item.innerHTML = `
        <div class="segment-info" style="cursor:pointer;flex:1;">
          <span style="font-weight: 600; color: #fff;">Clip ${sIdx + 1}</span>
          <span style="color: var(--tesla-muted); margin-left: 8px;">${DriveTimeline.format(seg.offset)} into drive · ${DriveTimeline.format(sDur)} · ${formatBytes(seg.clip.bytes || 0)}</span>
        </div>
        <div class="clip-row-actions" style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;">
          <button class="clip-row-raw" type="button" data-backup-recording="${seg.clip.id}" aria-label="Send to Remote Backup — Clip ${sIdx+1}" title="Send to Remote Backup using your phone">${driveIcon("upload")}<span>Send to Remote Backup</span></button>
          <button class="btn-lock-clip" type="button" title="${seg.clip.locked ? 'Recording is locked. Tap to unlock.' : 'Lock recording to prevent deletion'}" style="background:rgba(255,255,255,0.06);border:1px solid ${seg.clip.locked ? 'rgba(245,158,11,0.5)' : 'rgba(255,255,255,0.12)'};border-radius:6px;padding:5px 8px;cursor:pointer;color:${seg.clip.locked ? '#f59e0b' : 'var(--tesla-muted)'};display:inline-flex;align-items:center;justify-content:center;">${getLockSvg(seg.clip.locked, 13)}</button>
          <button class="btn-delete-clip" type="button" title="Delete recording" style="background:rgba(238,36,64,0.1);border:1px solid rgba(238,36,64,0.3);border-radius:6px;padding:5px 8px;cursor:pointer;color:#EE2440;display:inline-flex;align-items:center;justify-content:center;">${getTrashSvg(13)}</button>
          <button class="unit-toggle-pill btn-play-clip" type="button" aria-label="Play recording ${sIdx+1}" title="Play recording" style="padding: 2px 8px;">${driveIcon("play")}<span>Play</span></button>
        </div>
      `;

      item.querySelector('.segment-info').addEventListener("click", () => {
        playClipInDrive(seg.clip);
      });
      item.querySelector('.btn-play-clip').addEventListener("click", () => {
        playClipInDrive(seg.clip);
      });

      const lockClipBtn = item.querySelector('.btn-lock-clip');
      lockClipBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const target = !seg.clip.locked;
        lockClipBtn.disabled = true;
        try {
          await apiFetch(`/api/v1/recordings/${seg.clip.id}/lock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ locked: target })
          });
          seg.clip.locked = target;
          await loadLibrary();
        } catch (err) {
          alert('Could not update lock status.');
          lockClipBtn.disabled = false;
        }
      });

      const delClipBtn = item.querySelector('.btn-delete-clip');
      delClipBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (seg.clip.locked) {
          alert('This recording is locked. You must first unlock the recording before it can be deleted.');
          return;
        }
        if (!confirm(`Are you sure you want to delete Clip ${sIdx + 1}? This action cannot be undone.`)) return;
        delClipBtn.disabled = true;
        try {
          const res = await apiFetch(`/api/v1/recordings/${seg.clip.id}`, { method: 'DELETE' });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            alert(data.error || 'Failed to delete recording.');
            delClipBtn.disabled = false;
            return;
          }
          await loadLibrary();
        } catch (err) {
          alert(`Failed to delete: ${err.message}`);
          delClipBtn.disabled = false;
        }
      });

      driveSegmentsList.appendChild(item);
    });
  }

  function updateMetricsDisplay(drive) {
    if (!drive) return;
    const isMph = player.speedUnit === "mph";
    metricDistance.textContent = drive.metrics.distanceKm == null ? "—" : (isMph ? `${drive.metrics.distanceMiles} mi` : `${drive.metrics.distanceKm} km`);
    metricDuration.textContent = drive.durationFormatted;
    metricTopSpeed.textContent = drive.metrics.topSpeedKph == null ? "—" : isMph ? `${drive.metrics.topSpeedMph} MPH` : `${drive.metrics.topSpeedKph} KM/H`;
    metricAvgSpeed.textContent = drive.metrics.avgSpeedKph == null ? "—" : isMph ? `${drive.metrics.avgSpeedMph} MPH` : `${drive.metrics.avgSpeedKph} KM/H`;
    metricMaxSteering.textContent = drive.metrics.maxSteeringDeg == null ? "—" : `${drive.metrics.maxSteeringDeg}°`;
    metricBrakeEvents.textContent = drive.metrics.brakeEvents == null ? "—" : `${drive.metrics.brakeEvents}`;
  }

  // Play Drive button: Jump to playback and play from start
  overviewPlayBtn.addEventListener("click", () => {
    if (selectedDrive && selectedDrive.segments.length > 0) {
      playClipInDrive(selectedDrive.segments[0].clip, true);
    }
  });

  const overviewLockBtn = document.getElementById('overviewLockBtn');
  const overviewDeleteBtn = document.getElementById('overviewDeleteBtn');

  if (overviewLockBtn) {
    overviewLockBtn.addEventListener('click', async () => {
      if (!selectedDrive || !selectedDrive.segments.length) return;
      const isDriveLocked = selectedDrive.segments.every(s => s.clip.locked);
      const target = !isDriveLocked;
      overviewLockBtn.disabled = true;
      for (const seg of selectedDrive.segments) {
        try {
          await apiFetch(`/api/v1/recordings/${seg.clip.id}/lock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ locked: target })
          });
          seg.clip.locked = target;
        } catch (error) { alert('Could not save lock: '+error.message); break; }
      }
      await loadLibrary();
    });
  }

  if (overviewDeleteBtn) {
    overviewDeleteBtn.addEventListener('click', async () => {
      if (!selectedDrive || !selectedDrive.segments.length) return;
      if (selectedDrive.segments.some(s => s.clip.locked)) {
        alert('This drive contains locked recordings. Please unlock the drive or recordings before deleting.');
        return;
      }
      if (!confirm(`Are you sure you want to delete this drive (${selectedDrive.segments.length} recordings)? This action cannot be undone.`)) return;
      overviewDeleteBtn.disabled = true;
      for (const seg of selectedDrive.segments) {
        try {
          await apiFetch(`/api/v1/recordings/${seg.clip.id}`, { method: 'DELETE' });
        } catch (err) {
          alert(`Failed to delete recording: ${err.message}`);
          break;
        }
      }
      selectedDrive = null;
      window.BVRecordingBackupAction.update(overviewBackupBtn,null,window.BVSourceManager.source?.kind);
      await loadLibrary();
    });
  }

  const playbackLockBtn = document.getElementById('playbackLockBtn');
  const playbackLockIcon = document.getElementById('playbackLockIcon');
  const playbackLockLabel = document.getElementById('playbackLockLabel');
  const playbackDeleteBtn = document.getElementById('playbackDeleteBtn');

  function updateMoreBackupCurrent() {
    const backupCurrent=document.getElementById('moreBackupCurrentBtn');
    if(backupCurrent){const eligible=['car','usb'].includes(window.BVSourceManager.source?.kind)&&activeClip?.complete===true&&typeof activeClip.id==='string'&&detectedDrives.some(d=>d.segments.some(seg=>seg.clip.id===activeClip.id));backupCurrent.disabled=!eligible;if(eligible)backupCurrent.dataset.currentRecording=activeClip.id;else delete backupCurrent.dataset.currentRecording;}
  }
  function updatePlaybackLockUI() {
    updateMoreBackupCurrent();
    if (!playbackLockBtn || !activeClip) return;
    const isLocked = Boolean(activeClip.locked);
    if (playbackLockLabel) playbackLockLabel.textContent = isLocked ? 'Locked' : 'Lock';
    if (playbackLockIcon) playbackLockIcon.innerHTML = getLockSvg(isLocked, 15);
    playbackLockBtn.style.color = isLocked ? '#f59e0b' : 'inherit';
    playbackLockBtn.style.borderColor = isLocked ? 'rgba(245, 158, 11, 0.4)' : 'rgba(255, 255, 255, 0.15)';
    playbackLockBtn.title = isLocked ? 'Recording is locked. Tap to unlock.' : 'Lock recording to prevent deletion';
  }

  if (playbackLockBtn) {
    playbackLockBtn.addEventListener('click', async () => {
      if (!activeClip) return;
      const target = !activeClip.locked;
      playbackLockBtn.disabled = true;
      try {
        await apiFetch(`/api/v1/recordings/${activeClip.id}/lock`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locked: target })
        });
        activeClip.locked = target;
        updatePlaybackLockUI();
        for (const d of detectedDrives) {
          const found = d.segments.find(s => s.clip.id === activeClip.id);
          if (found) found.clip.locked = target;
        }
      } catch (_) {
        alert('Could not update recording lock status.');
      } finally {
        playbackLockBtn.disabled = false;
      }
    });
  }

  if (playbackDeleteBtn) {
    playbackDeleteBtn.addEventListener('click', async () => {
      if (!activeClip) return;
      if (activeClip.locked) {
        alert('This recording is locked. You must first unlock the recording before it can be deleted.');
        return;
      }
      if (!confirm('Are you sure you want to delete this recording? This action cannot be undone.')) return;
      playbackDeleteBtn.disabled = true;
      try {
        player.pause();
        const res = await apiFetch(`/api/v1/recordings/${activeClip.id}`, { method: 'DELETE' });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          alert(err.error || 'Failed to delete recording.');
          playbackDeleteBtn.disabled = false;
          return;
        }
        activeClip = null;
        updatePlaybackLockUI();
        switchTab('recordings');
        await loadLibrary();
      } catch (e) {
        alert(`Failed to delete recording: ${e.message}`);
      } finally {
        playbackDeleteBtn.disabled = false;
      }
    });
  }

  // Settings Modal Event Listeners
  const settingsModal = document.getElementById('settingsModal');
  const headerSettingsBtn = document.getElementById('headerSettingsBtn');
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');
  const dismissSettingsBtn = document.getElementById('dismissSettingsBtn');

  if (headerSettingsBtn && settingsModal) {
    headerSettingsBtn.addEventListener('click', () => {
      window.BVMoreMenuInstance?.close(false);
      settingsModal.classList.add('open');
      closeSettingsBtn?.focus();
    });
  }
  if (closeSettingsBtn && settingsModal) {
    closeSettingsBtn.addEventListener('click', () => {
      settingsModal.classList.remove('open');
      window.BVMoreMenuInstance?.trigger?.focus();
    });
  }
  if (dismissSettingsBtn && settingsModal) {
    dismissSettingsBtn.addEventListener('click', () => {
      settingsModal.classList.remove('open');
      window.BVMoreMenuInstance?.trigger?.focus();
    });
  }
  if (settingsModal) {
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) settingsModal.classList.remove('open');
    });
  }

  async function playClipInDrive(clip, autoPlay = true, startAt = 0) {
    const token = ++loadToken;
    player.cancelLoad();
    lastOpen={clip,autoPlay,startAt};
    const drive=detectedDrives.find(d=>d.segments.some(s=>s.clip.id===clip.id));
    activeDrive=drive||null;
    if(drive)timeline.setDrive(drive);
    activeClip=clip;
    window.BVRecordingCache?.setWindow(drive,clip.id,{native:player.nativeAvailable});
    recordingNavigation.update(true);
    updatePlaybackLockUI();
    document.getElementById('playbackTitle').textContent = drive ? `${drive.date} · ${drive.startTime}` : 'Drive playback';
    document.getElementById('playbackClipLabel').textContent = `Recording ${(drive?.segments.findIndex(s=>s.clip.id===clip.id) ?? 0)+1} of ${drive?.segments.length||1}`;
    document.getElementById('dockRecordingLabel').textContent=document.getElementById('playbackClipLabel').textContent;
    document.getElementById('loadingRetryBtn').hidden=true;
    document.getElementById('playbackRetryBtn').hidden=true;
    document.getElementById('loadingProgress').textContent='';
    videoLoadingModal.classList.remove('has-error');
    showLoadingModal('Preparing your recording','Reading video and synchronizing telemetry…');
    switchTab('playback');
    await paintLoading();
    if(token!==loadToken)return;
    const base=`/api/v1/recordings/${encodeURIComponent(clip.id)}`;
    try {
      await player.loadClip(`${base}/manifest.json`,`${base}/capture.bvr`, clip.id);
      if(token!==loadToken)return;
      const savedMapping=await cameraStore.load(clip.id);
      if(token!==loadToken)return;
      if(savedMapping){player.saveCameraMapping(savedMapping,clip.id);sessionConfirmedClips.add(clip.id);}
      await player.seekAndWait(startAt);
      if(token!==loadToken)return;
      await paintLoading();
      if(token!==loadToken)return;
      hideLoadingModal();
      window.BVRecordingCache?.start();

      if (!isClipIdentified(clip.id) && player.requiresCameraMappingAt(startAt)) {
        openIdentifyModal({
          clip,
          drive,
          isFirstTime: true,
          onComplete: () => {
            if (autoPlay) player.play({restartAtEnd:false});
          }
        });
      } else {
        if(autoPlay)await player.play({restartAtEnd:false});
      }
    } catch(error) {
      if(token!==loadToken || error.name==='AbortError')return;
      player.cancelLoad();
      videoLoadingModal.classList.add('has-error');
      document.getElementById('loadingRetryBtn').hidden=false;
      showLoadingModal('Could not open recording',error.message);
    }
  }

  document.getElementById('quickExportBtn').addEventListener('click',()=>document.getElementById('openExportBtn').click());
  document.getElementById('moreDrivesBtn').addEventListener('click',()=>{player.pause();switchTab('recordings');viewRecordings.classList.remove('detail-open');});
  document.getElementById('moreBackupCurrentBtn').addEventListener('click',event=>{const id=event.currentTarget.dataset.currentRecording;if(!id)return;try{Promise.resolve(window.BVBackupActions.openRecording(id)).catch(error=>alert(error.message));}catch(error){alert(error.message);}});

  // 6. Transport Controls
  hudElements.playBtn.addEventListener("click", () => player.togglePlay());

  hudElements.scrubber.addEventListener("input", (e) => {
    player.seek(parseFloat(e.target.value));
  });

  // 7. Speed Unit Management (MPH <-> KM/H)
  const unitBtnMph = document.getElementById("unitBtnMph");
  const unitBtnKph = document.getElementById("unitBtnKph");

  function setSpeedUnit(unit) {
    const nextUnit = unit === "km/h" ? "km/h" : "mph";
    player.setSpeedUnit(nextUnit);
    try {
      localStorage.setItem("bimmervision_speed_unit", nextUnit);
    } catch (_) {}

    if (unitBtnMph && unitBtnKph) {
      if (nextUnit === "mph") {
        unitBtnMph.classList.add("active");
        unitBtnMph.style.background = "var(--m-blue)";
        unitBtnMph.style.color = "#fff";
        unitBtnKph.classList.remove("active");
        unitBtnKph.style.background = "transparent";
        unitBtnKph.style.color = "var(--tesla-muted)";
      } else {
        unitBtnKph.classList.add("active");
        unitBtnKph.style.background = "var(--m-blue)";
        unitBtnKph.style.color = "#fff";
        unitBtnMph.classList.remove("active");
        unitBtnMph.style.background = "transparent";
        unitBtnMph.style.color = "var(--tesla-muted)";
      }
    }

    const exportUnitSelect = document.getElementById("exportUnitSelect");
    if (exportUnitSelect) exportUnitSelect.value = nextUnit;
    if (selectedDrive) updateMetricsDisplay(selectedDrive);
  }

  function toggleSpeedUnit() {
    setSpeedUnit(player.speedUnit === "mph" ? "km/h" : "mph");
  }

  const speedToggleEl = document.getElementById("speedToggle");
  if (speedToggleEl) speedToggleEl.addEventListener("click", toggleSpeedUnit);
  if (unitBtnMph) unitBtnMph.addEventListener("click", () => setSpeedUnit("mph"));
  if (unitBtnKph) unitBtnKph.addEventListener("click", () => setSpeedUnit("km/h"));

  try {
    const savedUnit = localStorage.getItem("bimmervision_speed_unit");
    if (savedUnit) setSpeedUnit(savedUnit);
  } catch (_) {}

  // 8. Desktop Keyboard Shortcuts
  window.addEventListener("keydown", (e) => {
    if (document.querySelector(".modal-backdrop.open") || videoLoadingModal.style.display === "flex") return;
    if (e.defaultPrevented || e.target.closest?.('input,select,textarea,button,a,summary,[contenteditable="true"]')) return;

    if (e.code === "Space") {
      e.preventDefault();
      player.togglePlay();
    } else if (e.code === "ArrowLeft") {
      e.preventDefault();
      player.step(-1);
    } else if (e.code === "ArrowRight") {
      e.preventDefault();
      player.step(1);
    } else if (e.key === "1") {
      player.setViewMode("quad");
    } else if (e.key === "2") {
      player.setViewMode("source");
    } else if (e.key === "3") {
      player.setViewMode("front");
    } else if (e.key === "4") {
      player.setViewMode("rear");
    } else if (e.key === "5") {
      player.setViewMode("left");
    } else if (e.key === "6") {
      player.setViewMode("right");
    }
  });

  // 10. Export Modal Controller
  const exportModal = document.getElementById("exportModal");
  const openExportBtn = document.getElementById("openExportBtn");
  const closeExportBtn = document.getElementById("closeExportBtn");
  const startExportBtn = document.getElementById("startExportAction");
  const exportProgress = document.getElementById("exportProgress");
  const progressBarFill = document.getElementById("progressBarFill");
  const progressText = document.getElementById("progressText");

  function getExportOverlays() {
    return {
      blinkers: document.getElementById("exportToggleBlinkers") ? document.getElementById("exportToggleBlinkers").checked : true,
      speed: document.getElementById("exportToggleSpeed") ? document.getElementById("exportToggleSpeed").checked : true,
      speedLimit: document.getElementById("exportToggleSpeedLimit") ? document.getElementById("exportToggleSpeedLimit").checked : true,
      steering: document.getElementById("exportToggleSteering") ? document.getElementById("exportToggleSteering").checked : true,
      brake: document.getElementById("exportToggleBrake") ? document.getElementById("exportToggleBrake").checked : true,
      gas: document.getElementById("exportToggleGas") ? document.getElementById("exportToggleGas").checked : true,
      time: document.getElementById("exportToggleTime") ? document.getElementById("exportToggleTime").checked : true,
      drivingView: document.getElementById("exportToggleDriving").checked && !document.getElementById("exportToggleDriving").disabled,
      map: document.getElementById("exportToggleMap") ? document.getElementById("exportToggleMap").checked : true,
    };
  }

  let exportDrivingPreview=null,exportPreviewEpoch=0,exportInProgress=false;
  function releaseExportDrivingPreview(){++exportPreviewEpoch;exportDrivingPreview?.dispose();exportDrivingPreview=null;}
  new MutationObserver(()=>{if(!exportModal.classList.contains('open'))releaseExportDrivingPreview();}).observe(exportModal,{attributes:true,attributeFilter:['class']});

  async function updateExportPreview() {
    const previewToken=++exportPreviewEpoch,recordingEpoch=player._clipEpoch;

    const previewCanvas = document.getElementById("exportPreviewCanvas");
    if (!previewCanvas) return;
    const view = document.getElementById("exportCameraSelect") ? document.getElementById("exportCameraSelect").value : "quad";
    const speedUnit = document.getElementById("exportUnitSelect") ? document.getElementById("exportUnitSelect").value : (player.speedUnit || "mph");
    const overlays = getExportOverlays();

    const midInfo = {
      fr:player.lastFrFrame,lr:player.lastLrFrame,time:player.currentTime||0,
      telemetry:player.parser?.getTelemetryAtTime(player.currentTime||0,player.manifest?.startMonotonicUs)
    };

    const tsEl = document.getElementById("exportPreviewTimestamp");
    if (tsEl && midInfo.time != null) {
      const mins = Math.floor(midInfo.time / 60);
      const secs = (midInfo.time % 60).toFixed(2).padStart(5, "0");
      tsEl.textContent = `${String(mins).padStart(2, "0")}:${secs}`;
    }

    const note=document.getElementById('exportDrivingNote');
    if(overlays.drivingView) {
      startExportBtn.disabled=true;
      if(!exportDrivingPreview) {
        note.textContent='Preparing Driving view preview…';
        try {
          const prepared=await player.drivingView.createExportRenderer();
          if(previewToken!==exportPreviewEpoch||recordingEpoch!==player._clipEpoch||!exportModal.classList.contains('open')){prepared.dispose();return;}
          exportDrivingPreview=prepared;
        } catch(error) {if(previewToken===exportPreviewEpoch){note.textContent=error.message;startExportBtn.disabled=true;}return;}
      }
      note.textContent=overlays.map?'Export sidebar: route map on top, Driving view below. Distances in feet.':'Export sidebar: Driving view. Distances in feet.';
      startExportBtn.disabled=exportInProgress;
    } else {
      exportDrivingPreview?.dispose();exportDrivingPreview=null;
      note.textContent=document.getElementById('exportToggleDriving').disabled?'This recording has no supported Driving view metadata available.':'Optional: add Driving view below the route map.';
      startExportBtn.disabled=exportInProgress;
    }

    if(overlays.map&&player.liveMap?.prepareForExport) {
      const sidebarNote=note.textContent;startExportBtn.disabled=true;note.textContent='Preparing map for preview…';
      try {
        await player.liveMap.prepareForExport(midInfo.time,640,overlays.drivingView?480:960,{check:()=>{if(previewToken!==exportPreviewEpoch||recordingEpoch!==player._clipEpoch||!exportModal.classList.contains('open'))throw new Error('Preview changed');}});
      } catch(error) {if(previewToken===exportPreviewEpoch)note.textContent=error.message;return;}
      if(previewToken!==exportPreviewEpoch||recordingEpoch!==player._clipEpoch)return;
      note.textContent=sidebarNote;startExportBtn.disabled=exportInProgress;
    }

    try {exporter.renderPreview(previewCanvas, {
      view: view,
      overlays: overlays,
      speedUnit: speedUnit,
      time: midInfo.time,
      fr: midInfo.fr,
      lr: midInfo.lr,
      telemetry: midInfo.telemetry,
      mapping: player.cameraMapping,
      manifest: player.manifest,
      map: player.liveMap,
      drivingView: exportDrivingPreview
    });} catch(error){exportDrivingPreview?.dispose();exportDrivingPreview=null;note.textContent=error.message;startExportBtn.disabled=true;}
  }

  const overlayCheckboxIds = [
    "exportToggleBlinkers",
    "exportToggleSpeed",
    "exportToggleSpeedLimit",
    "exportToggleSteering",
    "exportToggleBrake",
    "exportToggleGas",
    "exportToggleTime",
    "exportToggleMap",
    "exportToggleDriving"
  ];

  overlayCheckboxIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", updateExportPreview);
  });

  const exportCameraSelect = document.getElementById("exportCameraSelect");
  if (exportCameraSelect) exportCameraSelect.addEventListener("change", updateExportPreview);

  const exportUnitSelect = document.getElementById("exportUnitSelect");
  if (exportUnitSelect) exportUnitSelect.addEventListener("change", updateExportPreview);

  const selectAllOverlaysBtn = document.getElementById("exportSelectAllOverlays");
  if (selectAllOverlaysBtn) {
    selectAllOverlaysBtn.addEventListener("click", () => {
      overlayCheckboxIds.forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.disabled) el.checked = true;
      });
      updateExportPreview();
    });
  }

  const clearAllOverlaysBtn = document.getElementById("exportClearAllOverlays");
  if (clearAllOverlaysBtn) {
    clearAllOverlaysBtn.addEventListener("click", () => {
      overlayCheckboxIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.checked = false;
      });
      updateExportPreview();
    });
  }

  openExportBtn.addEventListener("click", () => {
    player.pause();
    exportModal.classList.add("open");
    const native = !!player._nativeVideo;
    const hasEncoder = (typeof VideoEncoder !== "undefined" && typeof Mp4Muxer !== "undefined") || typeof MediaRecorder !== "undefined";
    const nativeLink = document.getElementById('nativeDownloadLink');
    if (nativeLink) {
      nativeLink.style.display = native ? "inline-block" : "none";
      nativeLink.href = (native && player.nativeInfo) ? player.nativeInfo.downloadUrl : '#';
    }
    const rawLink=document.getElementById('rawRecordingDownloadLink');
    const rawId=player.activeClipId || player.manifest?.id;
    if(rawLink){rawLink.hidden=!rawId;rawLink.href='#';rawLink.dataset.rawRecording=rawId||'';}
    const nativeNote = document.getElementById('nativeExportNote');
    if (nativeNote) nativeNote.hidden = !native;

    document.getElementById('customExportOptions').hidden = false;
    exportProgress.style.display = "none";
    startExportBtn.disabled = false;
    startExportBtn.style.display = "flex";
    const manualBtn = document.getElementById("downloadExportLink");
    if (manualBtn) manualBtn.style.display = "none";

    const drivingToggle=document.getElementById('exportToggleDriving');
    drivingToggle.disabled=!player.drivingView?.data?.frames?.some(f=>f.o.length||f.b.length);
    if(drivingToggle.disabled)drivingToggle.checked=false;
    updateExportPreview();
  });

  closeExportBtn.addEventListener("click", () => {
    exportModal.classList.remove("open");
  });

  exportModal.addEventListener("click", (e) => {
    if (e.target === exportModal) exportModal.classList.remove("open");
  });

  startExportBtn.addEventListener("click", async (e) => {
    if(exportInProgress)return;
    exportInProgress=true;
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    startExportBtn.disabled = true;
    exportProgress.style.display = "flex";
    progressBarFill.style.width = "5%";
    progressText.textContent = "Initializing hardware encoder...";

    const cameraAngle = document.getElementById("exportCameraSelect").value;
    const overlays = getExportOverlays();
    const speedUnit = document.getElementById("exportUnitSelect").value;
    const durationOpt = document.getElementById("exportDurationSelect") ? document.getElementById("exportDurationSelect").value : "full";

    try {
      const result = await exporter.export({
        view: cameraAngle,
        overlays: overlays,
        speedUnit: speedUnit,
        duration: durationOpt,
        onProgress: (frac, status) => {
          progressBarFill.style.width = `${Math.round(frac * 100)}%`;
          progressText.textContent = status;
        }
      });

      if (window.lastExportUrl) URL.revokeObjectURL(window.lastExportUrl);
      const blob = new Blob([result.buffer], { type: "video/mp4" });
      const blobUrl = URL.createObjectURL(blob);
      window.lastExportUrl = blobUrl;
      const sizeMb = (result.buffer.byteLength / (1024 * 1024)).toFixed(1);

      progressBarFill.style.width = "100%";
      progressText.textContent = `Export complete! (${sizeMb} MB) Download started.`;

      // Trigger standard browser download via temporary anchor
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = result.fileName;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        if (a.parentNode) document.body.removeChild(a);
      }, 500);

      // Reveal permanent download button in modal as reliable fallback
      const manualBtn = document.getElementById("downloadExportLink");
      if (manualBtn) {
        manualBtn.href = blobUrl;
        manualBtn.download = result.fileName;
        manualBtn.textContent = `⬇ Download ${result.fileName} (${sizeMb} MB)`;
        manualBtn.style.display = "block";
      }

      startExportBtn.style.display = "none";

      // On mobile devices supporting Web Share, also trigger share sheet
      const file = new File([result.buffer], result.fileName, { type: "video/mp4" });
      if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            title: "BimmerVision Recording",
            text: `BimmerVision drive clip (${result.duration.toFixed(1)}s)`,
            files: [file]
          });
        } catch (_) {}
      }
    } catch (err) {
      console.error("Export failed:", err);
      progressText.textContent = "Export error: " + (err.message || String(err));
      alert("Export failed: " + (err.message || String(err)));
      startExportBtn.disabled = false;
    } finally {exportInProgress=false;}
  });

  // 11. Camera Identity Modal Controller (Matches Mac/Windows Desktop Alignment)
  const identifyModal = document.getElementById("identifyModal");
  const closeIdentifyBtn = document.getElementById("closeIdentifyBtn");
  const doneIdentifyBtn = document.getElementById("doneIdentifyBtn");
  const resetIdentifyBtn = document.getElementById("resetIdentifyBtn");
  const assignFrontRearBtn = document.getElementById("assignFrontRearBtn");
  const assignLeftRightBtn = document.getElementById("assignLeftRightBtn");
  const toggleFlipHalvesBtn = document.getElementById("toggleFlipHalvesBtn");
  const toggleInvertPhaseBtn = document.getElementById("toggleInvertPhaseBtn");
  const identifyCanvas = document.getElementById("identifyCanvas");
  const identifyInfoPill = document.getElementById("identifyInfoPill");
  const identifyLeftLabel = document.getElementById("identifyLeftLabel");
  const identifyRightLabel = document.getElementById("identifyRightLabel");
  const identifyPromptBadge = document.getElementById("identifyPromptBadge");
  const identifyModalDesc = document.getElementById("identifyModalDesc");

  let onIdentifyComplete = null;
  let identifyInspectPhase = 0;

  const sessionConfirmedClips = new Set();

  function isClipIdentified(clipId) {
    if (!clipId) return false;
    return sessionConfirmedClips.has(clipId);
  }

  let continueLocally=false, savingIdentity=false, localFallbackMapping=null;
  async function markClipIdentified(clipId) {
    await cameraStore.save(clipId,player.cameraMapping);
    sessionConfirmedClips.add(clipId);
  }

  function openIdentifyModal(options = {}) {
    player.pause();
    continueLocally=false;
    document.getElementById('identifySaveStatus').textContent='';
    onIdentifyComplete = options.onComplete || null;
    identifyInspectPhase = 0;
    const isFirstTime = !!options.isFirstTime;

    if (identifyPromptBadge) {
      identifyPromptBadge.style.display = isFirstTime ? "inline-block" : "none";
    }
    if (identifyModalDesc) {
      identifyModalDesc.innerHTML = isFirstTime
        ? "<strong>Camera Alignment Required:</strong> Please select Front/Rear and Left/Right camera assignments for this recording to ensure cockpit views and exports are correctly oriented."
        : "Name the side-by-side camera pair for this source frame to ensure views and exports are correctly oriented:";
    }
    if (doneIdentifyBtn) {
      doneIdentifyBtn.textContent = isFirstTime ? "Confirm & Play ▶" : "Apply & Done";
    }

    identifyModal.classList.add("open");
    renderIdentifyFrame();
    updateIdentifyUi();
  }

  function renderIdentifyFrame() {
    const raw = player.getCurrentRawFrame(identifyInspectPhase);
    if (!raw || !raw.bitmap) return;

    const idCtx = identifyCanvas.getContext("2d");
    idCtx.drawImage(raw.bitmap, 0, 0, 1280, 480);

    // Draw central split indicator line
    idCtx.strokeStyle = "rgba(61, 168, 242, 0.75)";
    idCtx.lineWidth = 3;
    idCtx.beginPath();
    idCtx.moveTo(640, 0);
    idCtx.lineTo(640, 480);
    idCtx.stroke();
  }

  function updateIdentifyUi() {
    const raw = player.getCurrentRawFrame(identifyInspectPhase);
    const map = player.cameraMapping || { phase0: "frontRear", phase1: "leftRight", flipHalves: false };

    const isP0 = (identifyInspectPhase === 0);
    const currentPair = isP0 ? map.phase0 : map.phase1;
    const pairName = currentPair === "frontRear" ? "Front / Rear" : "Left / Right";

    const ssrc = raw ? raw.ssrc : "—";
    const rtp = raw ? raw.rtpTimestamp : "—";
    const auIdx = raw ? raw.auIndex : (isP0 ? "0" : "1");

    identifyInfoPill.innerHTML = `
      <strong>Source Frame #${auIdx}</strong> · SSRC ${ssrc} · RTP ${rtp}<br>
      Stream Phase: <strong>${isP0 ? "Phase 0 (Even)" : "Phase 1 (Odd)"}</strong> · Assigned: <span style="color:var(--m-blue);font-weight:700;">${pairName}</span> · Halves: ${map.flipHalves ? "Swapped" : "Standard"} <span style="opacity:0.6;font-size:10px;">(Tap to view alternate pair)</span>
    `;

    // Dynamic labels above halves
    if (currentPair === "frontRear") {
      identifyLeftLabel.textContent = map.flipHalves ? "REAR (640×480)" : "FRONT (640×480)";
      identifyRightLabel.textContent = map.flipHalves ? "FRONT (640×480)" : "REAR (640×480)";
    } else {
      identifyLeftLabel.textContent = map.flipHalves ? "RIGHT (640×480)" : "LEFT (640×480)";
      identifyRightLabel.textContent = map.flipHalves ? "LEFT (640×480)" : "RIGHT (640×480)";
    }

    // Toggle active highlights on action buttons
    assignFrontRearBtn.classList.toggle("active-mapping", currentPair === "frontRear");
    assignLeftRightBtn.classList.toggle("active-mapping", currentPair === "leftRight");
    toggleFlipHalvesBtn.classList.toggle("active-mapping", !!map.flipHalves);
    toggleInvertPhaseBtn.classList.remove("active-mapping");
  }

  identifyInfoPill.style.cursor = "pointer";
  identifyInfoPill.addEventListener("click", () => {
    identifyInspectPhase = 1 - identifyInspectPhase;
    renderIdentifyFrame();
    updateIdentifyUi();
  });

  assignFrontRearBtn.addEventListener("click", () => {
    const isP0 = (identifyInspectPhase === 0);
    player.saveCameraMapping({
      phase0: isP0 ? "frontRear" : "leftRight",
      phase1: isP0 ? "leftRight" : "frontRear"
    }, activeClip?.id);
    renderIdentifyFrame();
    updateIdentifyUi();
  });

  assignLeftRightBtn.addEventListener("click", () => {
    const isP0 = (identifyInspectPhase === 0);
    player.saveCameraMapping({
      phase0: isP0 ? "leftRight" : "frontRear",
      phase1: isP0 ? "frontRear" : "leftRight"
    }, activeClip?.id);
    renderIdentifyFrame();
    updateIdentifyUi();
  });

  toggleFlipHalvesBtn.addEventListener("click", () => {
    const current = player.cameraMapping ? player.cameraMapping.flipHalves : false;
    player.saveCameraMapping({ flipHalves: !current }, activeClip?.id);
    renderIdentifyFrame();
    updateIdentifyUi();
  });

  toggleInvertPhaseBtn.addEventListener("click", () => {
    const curP0 = player.cameraMapping ? player.cameraMapping.phase0 : "frontRear";
    const curP1 = player.cameraMapping ? player.cameraMapping.phase1 : "leftRight";
    player.saveCameraMapping({
      phase0: curP1,
      phase1: curP0
    }, activeClip?.id);
    renderIdentifyFrame();
    updateIdentifyUi();
  });

  resetIdentifyBtn.addEventListener("click", () => {
    player.saveCameraMapping({
      phase0: "frontRear",
      phase1: "leftRight",
      flipHalves: false
    }, activeClip?.id);
    renderIdentifyFrame();
    updateIdentifyUi();
  });

  async function completeIdentify() {
    if(savingIdentity||!activeClip)return;
    savingIdentity=true;doneIdentifyBtn.disabled=true;
    const id=activeClip.id;
    try{
      if(!continueLocally || localFallbackMapping!==JSON.stringify(player.cameraMapping))await markClipIdentified(id);
      else sessionConfirmedClips.add(id);
      if(activeClip?.id!==id)return;
      identifyModal.classList.remove('open');
      const cb=onIdentifyComplete;onIdentifyComplete=null;cb?.();
    }catch(error){
      document.getElementById('identifySaveStatus').textContent=error.message;
      continueLocally=!!error.savedLocally;
      localFallbackMapping=JSON.stringify(player.cameraMapping);
      doneIdentifyBtn.textContent=continueLocally?'Continue with browser copy':'Retry save';
    }finally{savingIdentity=false;doneIdentifyBtn.disabled=false;}
  }
  // Dismissing an unconfirmed dialog never marks a recording as identified.
  closeIdentifyBtn.addEventListener('click',()=>{identifyModal.classList.remove('open');onIdentifyComplete=null;});
  doneIdentifyBtn.addEventListener('click',completeIdentify);

  if (openCalibrateBtn) {
    openCalibrateBtn.addEventListener("click", () => {
      if (!activeClip) return;
      openIdentifyModal({
        clip: activeClip,
        drive: activeDrive,
        isFirstTime: false,
        onComplete: () => {}
      });
    });
  }

  identifyModal.addEventListener("click", (e) => {
    if (e.target === identifyModal) {identifyModal.classList.remove('open');onIdentifyComplete=null;}
  });
});
