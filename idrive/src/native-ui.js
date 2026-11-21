"use strict";
var crypto = require("crypto"),
  fs = require("fs"),
  path = require("path"),
  qr = require("./qr");
var ROWS = [
  "HOME_ALL",
  "HOME_FRONT",
  "HOME_REAR",
  "HOME_REMOTE",
  "HOME_LEFT",
  "HOME_RIGHT",
  "HOME_AUTO",
  "HOME_DELETE",
];
function UI(o) {
  this.rhmi = o.rhmi;
  this.displayTimeZone = o.displayTimeZone || null;
  this.onboarding = o.onboarding || null;
  this.noticeHandled = false;
  this.report = o.report || function(e){console.error(String(e.message||e));};
  this.recording = o.recording;
  this.display = o.display;
  this.entry = o.entry;
  this.page = "home";
  this.nativePage = null;
  this.visible = false;
  this.closed = false;
  this.listeners = [];
  this.cache = {};
  this.rendering = null;
  this.renderAgain = false;
  this.visit = null;
  this.drivePage = 0;
  this.qrUrl = "";
  this.externalQr = false;
  this.nativeQr = false;
  this.preferExternalQr = o.preferExternalQr === true;
  this.message = "";
  this.backupUI = new (require("./remote-backup-ui").RemoteBackupUI)(this);
  this.recordedDrivesUI = new(require("./recorded-drives-ui").RecordedDrivesUI)(this);
  this.nowMs = o.nowMs || Date.now;
  this.deleteNoticeId = null;
  this.deleteNoticeVolumeToken = null;
}
UI.prototype.clearDeleteNotice = function () {
  this.deleteNoticeId = null;
  this.deleteNoticeVolumeToken = null;
};
UI.prototype.component = function (n) {
  if(n==="ABOUT_LIMIT")return this.rhmi.getByName(n);
  if ((this.page === "usb" || this.page === "delete-confirm") && /^HOME_/.test(n))
    return this.rhmi.getByName("USB_" + n.slice(5));
  if ((this.page === "connect" || this.page === "settings") && /^HOME_/.test(n)) {
    var aliases = { HOME_STATUS: "STATUS", HOME_TITLE: "TITLE", HOME_AUTO: "BACK" };
    if (this.page === "connect") aliases.HOME_QR = "QR";
    return aliases[n] ? this.rhmi.getByName((this.page === "connect" ? "PHONE_" : "ABOUT_") + aliases[n]) : null;
  }
  return this.rhmi.getByName(n);
};
UI.prototype.listen = function (em, event, fn) {
  if (em && em.on) {
    em.on(event, fn);
    this.listeners.push([em, event, fn]);
  }
};
UI.prototype.desk = function () {
  return this.recording
    ? this.recording.read()
    : { state: "Recorder unavailable", drives: [] };
};
UI.prototype.intent = function () {
  return this.recording ? this.recording.intent() : {};
};
UI.prototype.update = function (p) {
  if (this.recording) this.recording.update(p);
};
UI.prototype.revoke = function () {
  if (this.visit)
    this.update({
      transfer: { visit: this.visit, visible: false, heartbeat: Date.now() },
    });
  this.visit = null;
  this.qrUrl = "";
  this.externalQr = false;
  this.nativeQr = false;
  if (this.display) this.display.hide();
};
UI.prototype.beat = function () {
  if (this.visible && this.page === "connect" && this.visit && !this.closed)
    this.update({
      transfer: { visit: this.visit, visible: true, heartbeat: Date.now() },
    });
};
UI.prototype.text = async function (n, value) {
  var c = this.component(n);
  if (c && c.setValue && this.cache[n] !== String(value)) {
    await c.setValue(0, "Text", String(value), "Text");
    this.cache[n] = String(value);
  }
};
UI.prototype.initialize = async function () {
  var self = this;
  this.backupUI.initialize();
  this.recordedDrivesUI.initialize();
  ["PHONE_BACK", "ABOUT_BACK"].forEach(function (name) {
    self.listen(self.component(name), "action", function () {
      if (self.nativePage === (name === "PHONE_BACK" ? "CONNECT_PHONE" : "ABOUT") && self.visible)
        self.back().catch(self.report);
    });
  });
  self.listen(self.component("ABOUT_LIMIT"),"action",function(){
    if(self.nativePage!=="ABOUT"||!self.visible)return;
    var preference=require("./recording-preference"),current=self.intent().internalStorageLimitBytes||self.desk().internalStorageLimitBytes||preference.DEFAULT_INTERNAL_LIMIT,
      next=current>=preference.MAX_INTERNAL_LIMIT?1000000000:current+1000000000;
    self.update({internalStorageLimitBytes:next});
    self.message="";
    self.render().catch(self.report);
  });
  ["CONNECT_PHONE", "ABOUT"].forEach(function (name) {
    self.listen(self.component(name), "visible", function (e) {
      if (self.nativePage !== name || !e) return;
      if (e.visible) { self.visible = true; return; }
      self.nativePage = null; self.visible = false; self.page = "home";
      self.cache = {}; self.revoke();
    });
  });
  ROWS.forEach(function (row) {
    self.listen(self.component("USB_" + row.slice(5)), "action", function () {
      if (self.nativePage !== "USB_STORAGE" || self.recordedDrivesUI.active || !self.visible) return;
      Promise.resolve(row === "HOME_AUTO" ? self.back() : self.press(row, true)).catch(self.report);
    });
    self.listen(self.component(row), "action", function () {
      Promise.resolve(
        row === "HOME_AUTO" ? self.back() : self.press(row)
      ).catch(function (e) {
        self.report(e);
        self.message = row === "HOME_REMOTE" ? "Remote Backup could not open" : e.message;
      });
    });
  });
  this.listen(this.component("HOME"), "visible", function (e) {
    self.visible = !!(e && e.visible);
    if (!self.visible && (self.nativePage || self.backupUI.active || self.recordedDrivesUI.active)) { self.visible=true; return; }
    if (!self.visible) {
      self.revoke();
      self.clearDeleteNotice();
      self.page = "home";
    }
  });
  this.listen(this.rhmi, "applicationStackChanged", function (stack) {
    if (stack && Object.prototype.hasOwnProperty.call(stack, "ROOT_APP"))
      self.seenRoot = true;
    if (!self.seenRoot) return;
    var h = self.component("HOME"),
      id = h.getId(),
      roots = stack && Array.isArray(stack.ROOT_APP) ? stack.ROOT_APP : [];
    var usb = self.component("USB_STORAGE");
    if (usb && String(roots[roots.length - 1]) === String(usb.getId())) {
      if (self.nativePage !== "USB_STORAGE" || self.recordedDrivesUI.active) self.cache = {};
      self.recordedDrivesUI.active = false;
      self.backupUI.active = false;
      self.nativePage = "USB_STORAGE";
      if (self.page !== "delete-confirm") self.page = "usb";
      self.visible = true;
      return;
    }
    if (String(roots[roots.length - 1]) === String(id)) self.visible = true;
    // The hardware Back control pops native states without invoking our Back
    // buttons. Release submenu ownership when the home state is on top.
    if (String(roots[roots.length - 1]) === String(id) &&
        (self.nativePage || self.backupUI.active || self.recordedDrivesUI.active)) {
      self.nativePage = null;
      self.revoke();
      self.backupUI.active = false;
      self.recordedDrivesUI.active = false;
      self.page = "home";
      self.cache = {};
      self.visible = true;
    }
    if (self.nativePage && roots.some(function (x) { return String(x) === String(self.component(self.nativePage).getId()); })) { self.visible = true; return; }
    if (self.backupUI.active) {
      var backupPage = ["REMOTE_BACKUP", "REMOTE_BACKUP_SETUP"].filter(function (n) {
        var c = self.component(n); return c && String(c.getId()) === String(roots[roots.length - 1]);
      })[0];
      if (backupPage) {
        var nextPage = backupPage === "REMOTE_BACKUP_SETUP" ? "account" : "backup";
        if (self.backupUI.page !== nextPage) { self.backupUI.page = nextPage; self.backupUI.cache = {}; }
        self.visible = true;
        return;
      }
    }
    if((self.backupUI.active || self.recordedDrivesUI.active) && roots.some(function(x){return ["REMOTE_BACKUP","REMOTE_BACKUP_SETUP","RECORDED_DRIVES"].some(function(n){var c=self.component(n);return c&&String(c.getId())===String(x);});})) {self.visible=true;return;}
    if (
      !roots.some(function (x) {
        return String(x) === String(id);
      })
    ) {
      self.visible = false;
      self.nativePage = null;
      self.backupUI.active=false;self.recordedDrivesUI.active=false;
      self.revoke();
      self.clearDeleteNotice();
      self.page = "home";
    }
  });
  var home = this.component("HOME");
  if (home.updateResources) await home.updateResources();
  await this.rhmi.mapEntryState(this.entry, home);
  await this.render();
};
UI.prototype.showRecordingAlert = async function (notice) {
  if(this.closed)return;
  var expiresAt=Date.now()+1800;
  var overlay=this.component('RECORDING_ALERT'),text=this.component('RECORDING_ALERT_TEXT');
  if(!overlay||!text||!text.setValue)throw Error('Recording notification overlay unavailable');
  if(overlay.updateResources)await overlay.updateResources();
  await text.setValue(0,'Description_Text',notice.message,'Text');
  if(this.closed||notice.kind!=='test'&&this.intent().continuous===false)return;
  if(Date.now()>expiresAt)throw Error('Recording notification expired');
  await this.rhmi.openState('RECORDING_ALERT');
};
UI.prototype.openMenu = async function () {
  if (this.closed) return;
  this.clearDeleteNotice();
  this.backupUI.active=false;this.recordedDrivesUI.active=false;
  this.revoke();
  this.page = "home";
  this.nativePage = null;
  if(this.onboarding&&!this.noticeHandled){try{if(this.onboarding.pending())this.page="welcome";}catch(e){this.report(e);this.page="welcome";}}
  await this.rhmi.mapEntryState(this.entry, this.component("HOME"));
  try {
    await this.rhmi.openEntryState(this.entry);
  } catch (e) {
    if (!/INVALID_UUID/.test(e.message)) throw e;
  }
  await this.rhmi.openState("HOME");
  this.visible = true;
  await this.render();
};
UI.prototype.press = async function (row, nativeUsb) {
  if (this.closed || !this.visible || this.nativePage && !(this.nativePage === "USB_STORAGE" && nativeUsb) || (this.backupUI && this.backupUI.active || this.recordedDrivesUI && this.recordedDrivesUI.active)) return;
  var desk = this.desk(),
    intent = this.intent();
  if (desk.setupPending && (this.page === "home" && ["HOME_ALL", "HOME_LEFT"].indexOf(row) >= 0 || this.page === "usb" && row === "HOME_DELETE" || this.page === "delete-confirm" && row === "HOME_ALL")) {
    this.message = desk.state || "Recorder setup pending";
    await this.render();
    return;
  }
  if(this.page==="welcome"){if(row==="HOME_ALL"){try{this.onboarding.acknowledge();}catch(e){this.report(e);}this.noticeHandled=true;this.page="home";await this.render();}return;}
  if (this.page === "home") {
    if (row === "HOME_ALL") {
      if (!desk.drive)
        this.message = "Select recording storage before recording.";
      else {
        this.message = "";
        this.update({ continuous: intent.continuous !== true });
      }
    }
    else if (row === "HOME_REAR") {
      this.clearDeleteNotice();
      this.drivePage = 0;
      await this.openNativePage("usb", "USB_STORAGE");
    } else if (row === "HOME_LEFT") {
      if(!desk.drive){this.message="Select recording storage first.";await this.render();return;}
      this.revoke();
      this.visit = crypto.randomBytes(16).toString("hex");
      await this.openNativePage("connect", "CONNECT_PHONE");
      this.beat();
    }
    else if (row === "HOME_REMOTE") {this.revoke();await this.backupUI.open();return;}
    else if (row === "HOME_RIGHT") {this.message="";await this.openNativePage("settings", "ABOUT");}
  } else if (this.page === "delete-confirm") {
    if(row === "HOME_ALL"){
      if(!desk.drive||desk.drive.mount!==this.deleteVolume){this.message="The selected recording storage changed. Nothing deleted.";this.page="usb";}
      else {this.revoke();var deleteId=crypto.randomBytes(16).toString('hex');this.deleteNoticeId=deleteId;this.deleteNoticeVolumeToken=this.deleteVolumeToken;this.update({continuous:false,deleteAll:{id:deleteId,volume:this.deleteVolume,volumeToken:this.deleteVolumeToken,confirmed:true}});this.message="";this.page="usb";}
    }else if(row === "HOME_FRONT"){this.page="usb";this.message="";}
  } else if (this.page === "usb") {
    if(row === "HOME_REMOTE" && desk.drive){this.revoke();await this.recordedDrivesUI.open();return;}
    if(row === "HOME_DELETE" && desk.drive){this.clearDeleteNotice();this.deleteVolume=desk.drive.mount;this.deleteVolumeToken=desk.volumeToken;this.page="delete-confirm";this.message="";await this.render();return;}
    var i = ["HOME_ALL", "HOME_FRONT", "HOME_REAR", "HOME_LEFT"].indexOf(row),
      drives = desk.drives || [];
    if (i >= 0 && drives[this.drivePage * 4 + i]) {
      var target = drives[this.drivePage * 4 + i].mount,
        current = desk.drive && desk.drive.mount;
      if (
        current &&
        target !== current &&
        (desk.activeId || desk.state === "Recording")
      )
        this.message =
          "Cannot disconnect the drive while a recording is saving.";
      else {
        this.message = "";
        this.update({ volume: target });
      }
    }
    else if (row === "HOME_RIGHT")
      this.drivePage =
        (this.drivePage + 1) % Math.max(1, Math.ceil(drives.length / 4));
  } else if (this.page === "connect" && row === "HOME_ALL") {
    this.revoke();
    this.page = "home";
  }
  await this.render();
};
UI.prototype.back = async function () {
  if(this.closed || !this.visible || (this.backupUI && this.backupUI.active || this.recordedDrivesUI && this.recordedDrivesUI.active))return;
  this.clearDeleteNotice();
  this.revoke();
  this.page = "home";
  if (this.nativePage) { this.nativePage = null; this.cache = {}; await this.rhmi.openState("HOME"); }
  await this.render();
};
UI.prototype.openNativePage = async function (page, state) {
  this.page = page;
  this.nativePage = state;
  this.cache = {};
  try {
    var c = this.component(state);
    if (c && c.updateResources) await c.updateResources();
    await this.rhmi.openState(state);
    this.visible = true;
  } catch (e) {
    this.nativePage = null; this.page = "home"; this.cache = {}; this.revoke();
    throw e;
  }
};
function bytes(n) {
  if (typeof n !== "number" || !isFinite(n)) return "Unknown";
  if (n < 1024) return n + " B";
  var units = ["KiB", "MiB", "GiB", "TiB"],
    i = -1;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < 3);
  return n.toFixed(1) + " " + units[i];
}
UI.prototype.render = function () {
  if (this.closed) return Promise.resolve();
  if (this.rendering) { this.renderAgain = true; return this.rendering; }
  var self = this;
  this.rendering = (async function () {
    try {
      do {
        self.renderAgain = false;
        await self.renderPage();
      } while (self.renderAgain && !self.closed);
    } finally { self.rendering = null; }
  })();
  return this.rendering;
};
UI.prototype.renderPage = async function () {
  if (this.closed) return;
  if(this.recordedDrivesUI.active){await this.recordedDrivesUI.render();return;}
  if(this.backupUI.active){await this.backupUI.render();return;}
  var desk = this.desk(),
    intent = this.intent(),
    drive = desk.drive,
    labels = { HOME_TITLE: "BimmerVision" },
    transfer = desk.transfer || {};
  var deletionNotice="";
  if(this.page==="usb" && this.deleteNoticeId && desk.volumeToken===this.deleteNoticeVolumeToken) {
    var result=desk.deleteResult;
    if(result && result.id===this.deleteNoticeId) deletionNotice=result.error || (result.deleted+" recordings erased · "+(result.locked||0)+" locked kept"+(result.retainedDependencies?" · "+result.retainedDependencies+" needed for playback":""));
    else deletionNotice="Erasing unlocked recordings…";
  }
  var enabled = intent.continuous === true,
    finishing = !desk.deleting && (desk.finalizing === true || desk.state === "Saving last video" ||
      !enabled && (desk.activeId || desk.writeInProgress === true && desk.finalizing === undefined || desk.state === "Recording")),
    videoWriting = finishing || desk.finalizing === true || desk.activeId || desk.state === "Recording" || desk.state === "Saving last video",
    writingMessage = "Do not disconnect - " + (videoWriting ? "Saving last video" : "Writing to storage"),
    recordingState = finishing ? "Saving last video" :
      ((desk.state === "Recording" || desk.activeId) ? "Recording" : (desk.state || "Recorder unavailable"));
  if(this.visible && enabled && !finishing && desk.state==="Recording" && desk.activeId && !desk.error && !desk.deleting) labels.HOME_TITLE="BimmerVision   "+(Math.floor(this.nowMs()/500)%2?"○":"●")+" REC";
  if(this.page === "connect" && !drive){
    this.revoke();this.page="home";this.message="Recording storage unavailable. Connect Phone unavailable.";
    if(this.nativePage){this.nativePage=null;this.cache={};await this.rhmi.openState("HOME");}
  }
  if(this.page==="welcome"){labels.HOME_STATUS=require("./first-run-notice").message;labels.HOME_ALL="Understood";labels.HOME_AUTO="Back";}
  else if (this.page === "home") {
    labels.HOME_STATUS =
      recordingState + (drive && typeof desk.recordingCount === "number" ? " · " + desk.recordingCount + " recordings" : "") +
      "\n" +
      (drive
        ? (drive.internal ? "Internal storage" : (drive.name || drive.mount || "USB")) +
          " · " +
          bytes(drive.used) +
          " used · " +
          bytes(drive.free) +
          (drive.internal ? " available / " : " free / ") +
          bytes(drive.total) +
          (drive.internal ? " limit" : "")
        : desk.drives && desk.drives.length
          ? "Select recording storage"
          : "No writable recording storage detected") +
      (drive ? "\n" + (desk.deleting ? "Do not disconnect - Deleting recordings" : (desk.writeInProgress===true || desk.writeInProgress===undefined && videoWriting) ? writingMessage : drive.internal ? "Internal storage · Retention enabled" : desk.safeToRemove===false || desk.error ? "USB error - Safe removal not confirmed" : "Safe to Remove") : "") +
      "";
    labels.HOME_ALL = drive
      ? enabled
        ? "Pause recording"
        : "Enable recording"
      : "Enable recording";
    labels.HOME_REAR = "Recording storage";
    labels.HOME_REMOTE = "Remote Backup";
    labels.HOME_LEFT = "Connect Phone";
    labels.HOME_RIGHT = "About";
  } else if (this.page === "delete-confirm") {
    labels.HOME_STATUS="Erase all unlocked recordings?\n"+(drive ? drive.name||drive.mount : "USB disconnected")+" · "+(desk.lockedRecordingCount==null?"Locked count unavailable":desk.lockedRecordingCount+" locked")+"\nLocked recordings are kept. This cannot be undone.";
    labels.HOME_ALL="Erase unlocked recordings";labels.HOME_FRONT="Cancel";labels.HOME_AUTO="Back";
  } else if (this.page === "usb") {
    labels.HOME_STATUS =
      "Recording storage\n" +
      (drive
        ? (drive.internal ? "Internal storage" : (drive.name || drive.mount)) +
          " · " +
          bytes(drive.free) +
          (drive.internal ? " available / " : " free / ") +
          bytes(drive.total)
        : "Select a drive for recordings");
    var drives = desk.drives || [],
      rows = ["HOME_ALL", "HOME_FRONT", "HOME_REAR", "HOME_LEFT"];
    for (var n = 0; n < 4; n++) {
      var d = drives[this.drivePage * 4 + n];
      if (d)
        labels[rows[n]] =
          (desk.drive && d.mount === desk.drive.mount ? "Selected · " : "") +
          (d.internal ? "Internal storage" : (d.name || d.mount)) +
          " · " +
          bytes(d.free) +
          (d.internal ? " available" : " free");
    }
    if (!drives.length)
      labels.HOME_STATUS +=
        "\nNo writable recording storage detected";
    if(drive) labels.HOME_REMOTE="Recorded Drives";
    if(drive) labels.HOME_DELETE="Erase all unlocked recordings…";
    if(drive) labels.HOME_STATUS+="\n"+(desk.recordingCount==null?"":desk.recordingCount+" recordings · ")+(desk.lockedRecordingCount==null?"Locked count unavailable · ":desk.lockedRecordingCount+" locked · ")+(desk.deleting?"Do not disconnect - Deleting recordings":desk.writeInProgress?writingMessage:drive.internal?"Internal storage · Retention enabled":desk.safeToRemove===false||desk.error?"USB error - Safe removal not confirmed":"Safe to Remove");
    if (drives.length > 4) labels.HOME_RIGHT = "Next drives";
    labels.HOME_AUTO = "Back";
  } else if(this.page==="settings") {
    var limit=intent.internalStorageLimitBytes||desk.internalStorageLimitBytes||require("./recording-preference").DEFAULT_INTERNAL_LIMIT;
    labels.HOME_STATUS="BimmerVision "+require('../package.json').version+" · GitHub: Hexphase/BimmerVision\nBimmerVision.App · Connect Phone opens the local viewer.\nInternal storage removes oldest unlocked clips to stay within its limit.";
    labels.ABOUT_LIMIT="Internal limit: "+(limit/1000000000)+" GB · Change";
    labels.HOME_AUTO="Back";
  } else {
    labels.HOME_STATUS = "Connect Phone" +
      (transfer.paired ? " · Connected" : transfer.code ? " · Code " + transfer.code : "") + "\n" +
      (transfer.paired ? "One device connected" : transfer.code ? (transfer.url||"").split("/?")[0] : transfer.error || "Starting connection…") +
      "\n" + "BMW Wi-Fi / CarPlay · Keep this screen open";
    labels.HOME_AUTO = "Back";
  }
  if(this.page==="home"&&desk.backup&&desk.backup.autoUpload&&desk.backup.storageFull)labels.HOME_BACKUP_WARNING="REMOTE BACKUP PAUSED -  REMOTE STORAGE FULL";
  var notice=this.message||desk.storageWarning||desk.error||deletionNotice;
  if(notice){if(this.page==="home"||this.page==="usb")labels.HOME_STATUS=notice+(this.page==="home"&&drive&&typeof desk.recordingCount==="number"?" · "+desk.recordingCount+" recordings":"")+labels.HOME_STATUS.slice(labels.HOME_STATUS.indexOf("\n"));else labels.HOME_STATUS+="\n"+notice;}
  var all = ["HOME_STATUS", "HOME_TITLE", "HOME_QR", "HOME_BACKUP_WARNING", "ABOUT_LIMIT"].concat(ROWS);
  for (var j = 0; j < all.length; j++) {
    var name = all[j],
      c = this.component(name),
      value = labels[name];
    if (c && c.setVisible) await c.setVisible(value !== undefined);
    if (value !== undefined) await this.text(name, value);
    if (name === "HOME_ALL" && c && c.setEnabled)
      await c.setEnabled(this.page !== "home" || !!drive);
    if(name === "HOME_FRONT" && c && c.setEnabled) await c.setEnabled(true);
    if(name === "HOME_LEFT" && c && c.setEnabled) await c.setEnabled(this.page !== "home" || !!drive);
    if(name === "HOME_DELETE" && c && c.setEnabled) await c.setEnabled(!!drive && !desk.deleting);
    if(name === "ABOUT_LIMIT" && c && c.setEnabled) await c.setEnabled(this.page === "settings");
    if (name === "HOME_QR" && c && c.setVisible)
      await c.setVisible(this.page === "connect" && transfer.on === true && !!transfer.url && this.nativeQr === true);
  }
};
UI.prototype.publishQr = async function (url,componentName,resourceName) {
  var image = this.component(componentName||"HOME_QR");
  resourceName=resourceName||"pairing-qr.png";
  if (!image || !image.setRowGraphic || !image.getResourceBundle) return false;
  var bundle = image.getResourceBundle();
  if (!bundle || !bundle.resourceFolder || !bundle.createResourceHandles) return false;
  var file = path.join(bundle.resourceFolder, resourceName);
  fs.writeFileSync(file, qr.png(url));
  if (
    bundle.resourceTable &&
    Number.isInteger(bundle.resourceTable[resourceName]) &&
    bundle.destroyResourceHandles
  ) {
    await bundle.destroyResourceHandles([resourceName]);
    delete bundle.resourceTable[resourceName];
  }
  await bundle.createResourceHandles([resourceName]);
  await image.setRowGraphic(0, resourceName);
  if (image.setVisible) await image.setVisible(true);
  return true;
};
UI.prototype.paint = async function () {
  if (this.closed || !this.visible) return;
  if((this.backupUI && this.backupUI.active || this.recordedDrivesUI && this.recordedDrivesUI.active)){await this.render();return;}
  if (this.page === "connect" && this.visit) {
    var transfer = this.desk().transfer || {};
    if (transfer.url && transfer.url !== this.qrUrl) {
      var shown = false;
      this.nativeQr = false;
      this.externalQr = false;
      // Dedicated Connect Phone state owns a native image. Legacy bottom-right
      // renderer settings must not bypass that image or cache a failed draw.
      try { shown = !!(await this.publishQr(transfer.url)); } catch (e) {}
      if (shown) {
        this.nativeQr = true;
        if (this.display && this.display.hide) this.display.hide();
      } else if (this.display && this.display.draw) {
        try { shown = (await this.display.draw(qr.frame(transfer.url))) === true; }
        catch (e) { shown = false; }
        this.externalQr = shown;
      }
      if (shown) {
        this.qrUrl = transfer.url;
        if (/^QR unavailable/.test(this.message)) this.message = "";
      } else this.message = "QR unavailable — use the code above";
    } else if (transfer.url && this.externalQr && this.display && this.display.hold) {
      if ((await this.display.hold()) === false) {
        this.qrUrl = "";
        this.externalQr = false;
      }
    } else if (!transfer.url && (this.qrUrl || this.nativeQr)) {
      this.qrUrl = "";
      this.externalQr = false;
      this.nativeQr = false;
      if (this.display) this.display.hide();
    }
  }
  await this.render();
};
UI.prototype.close = function () {
  this.clearDeleteNotice();
  this.revoke();
  this.closed = true;
  this.visible = false;
  this.listeners.forEach(function (x) {
    x[0].removeListener(x[1], x[2]);
  });
  this.listeners = [];
};
module.exports = { UI: UI };
