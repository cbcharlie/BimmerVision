"use strict";
var crypto = require("crypto");
var date = require("./drive-time").format;

function RemoteBackupUI(owner) {
  this.owner = owner;
  this.active = false;
  this.page = "backup";
  this.drivePage = 0;
  this.history = 0;
  this.qrUrl = "";
  this.message = "";
  this.cache = {};
}
function remainingTime(seconds) {
  var minutes = Math.ceil(Math.max(0, seconds) / 60);
  if (minutes <= 60) return minutes + " min";
  var hours = Math.floor(minutes / 60), rest = minutes % 60;
  return hours + " hour" + (hours === 1 ? "" : "s") + " and " +
    ("0" + rest).slice(-2) + " minute" + (rest === 1 ? "" : "s");
}
RemoteBackupUI.prototype.pageDrives = async function (delta) {
  if (!this.canAct("backup")) return;
  var backup = this.backup();
  if (!backup.configured) return;
  var last = Math.max(0, Math.ceil((backup.drives || []).length / 5) - 1);
  this.drivePage = Math.max(0, Math.min(last, this.drivePage + delta));
  await this.render();
};
RemoteBackupUI.prototype.canAct = function (page) {
  return (
    this.active &&
    !this.owner.closed &&
    this.owner.visible !== false &&
    (!page || this.page === page)
  );
};
RemoteBackupUI.prototype.backup = function () {
  return (
    this.owner.desk().backup || {
      configured: false,
      drives: [],
      completed: [],
      wifi: { eligible: false },
    }
  );
};
RemoteBackupUI.prototype.send = function (action, fields) {
  this.owner.update({
    backupCommand: Object.assign(
      { id: crypto.randomBytes(16).toString("hex"), action: action },
      fields,
    ),
  });
};
RemoteBackupUI.prototype.initialize = function () {
  var self = this,
    o = this.owner;
  function bind(name, event, fn) {
    o.listen(o.component(name), event, function (value) {
      if (
        event !== "visible" &&
        !self.canAct(
          name === "BACKUP_BEGIN" ||
            name === "BACKUP_DISCONNECT" ||
            name === "BACKUP_CANCEL" ||
            name === "BACKUP_ACCOUNT_BACK"
            ? "account"
            : "backup",
        )
      )
        return;
      Promise.resolve(fn(value)).catch(function (error) {
        if (o.report) o.report(error);
        self.message = "Remote backup action unavailable";
      });
    });
  }
  bind("BACKUP_SETUP", "action", function () {
    return self.setup();
  });
  bind("BACKUP_ACCOUNT", "action", function () {
    return self.setup();
  });
  bind("BACKUP_AUTO", "change", function (e) {
    return self.change("auto", e.selected);
  });
  bind("BACKUP_PAUSE", "change", function (e) {
    return self.change("pause", e.selected);
  });
  bind("BACKUP_STATIONARY", "change", function (e) {
    return self.change("stationary", e.selected);
  });
  bind("BACKUP_LOCKED", "change", function (e) {
    return self.change("locked", e.selected);
  });
  bind("BACKUP_PREVIOUS_DRIVES", "action", function () { return self.pageDrives(-1); });
  bind("BACKUP_NEXT_DRIVES", "action", function () { return self.pageDrives(1); });
  bind("BACKUP_HISTORY", "change", function (e) {
    self.history = Math.max(0, e.row || 0);
    return self.render();
  });
  bind("BACKUP_BEGIN", "action", function () {
    return self.begin();
  });
  bind("BACKUP_DISCONNECT", "action", function () {
    if (self.backup().configured) self.send("disconnect");
    self.qrUrl = "";
    return self.render();
  });
  bind("BACKUP_CANCEL", "action", function () {
    if (!self.backup().setup) return;
    self.send("cancel-setup");
    return self.open();
  });
  bind("BACKUP_BACK", "action", function () {
    return self.back();
  });
  bind("BACKUP_ACCOUNT_BACK", "action", function () {
    return self.open();
  });
  ["REMOTE_BACKUP", "REMOTE_BACKUP_SETUP"].forEach(function (name) {
    bind(name, "visible", function (e) {
      if (e && e.visible && self.active) o.visible = true;
    });
  });
};
RemoteBackupUI.prototype.show = async function (name) {
  var c = this.owner.component(name);
  if (c && c.updateResources) await c.updateResources();
  this.cache={};
  await this.owner.rhmi.openState(name);
  this.owner.visible = true;
};
RemoteBackupUI.prototype.navigate = async function(page,state){
 var previous={active:this.active,page:this.page,ownerPage:this.owner.page||"home"};
 this.active=true;this.page=page;this.message="";
 try{await this.show(state);await this.render();}
 catch(error){
  if(this.owner.closed){this.active=false;throw error;}
  this.active=previous.active;this.page=previous.page;this.owner.page=previous.ownerPage;this.owner.visible=true;this.cache={};
  this.message="Remote backup action unavailable";this.owner.message="Remote Backup could not open";
  try{await this.owner.rhmi.openState(previous.active?(previous.page==="account"?"REMOTE_BACKUP_SETUP":"REMOTE_BACKUP"):"HOME");await this.owner.render();}catch(restoreError){if(this.owner.report)this.owner.report(restoreError);}
  throw error;
 }
};
RemoteBackupUI.prototype.open = function(){return this.navigate("backup","REMOTE_BACKUP");};
RemoteBackupUI.prototype.setup = function(){return this.navigate("account","REMOTE_BACKUP_SETUP");};
RemoteBackupUI.prototype.back = async function () {
  this.active = false;
  this.qrUrl = "";
  this.owner.page = "home";
  await this.owner.rhmi.openState("HOME");
  await this.owner.render();
};
RemoteBackupUI.prototype.begin = async function () {
  if (!this.canAct("account")) return;
  var b = this.backup();
  if (b.setup) return;
  if (!b.wifi || !b.wifi.eligible) {
    this.message = "Connect car to Wi-Fi to begin setup";
    await this.render();
    return;
  }
  this.send("setup");
  this.message = "Requesting Google sign-in code…";
  await this.render();
};
RemoteBackupUI.prototype.change = async function (name, value) {
  var b = this.backup();
  delete this.cache[
    (name === "auto"
      ? "BACKUP_AUTO"
      : name === "stationary"
        ? "BACKUP_STATIONARY"
        : name === "locked"
        ? "BACKUP_LOCKED"
        : "BACKUP_PAUSE") + ".selected"
  ];
  if (
    !this.canAct("backup") ||
    !b.configured ||
    (name === "pause" && !b.autoUpload)
  ) {
    await this.render();
    return;
  }
  this.send(
    "settings",
    name === "auto"
      ? { autoUpload: value === true }
      : name === "stationary"
        ? { doNotBackupWhileDriving: value === true }
        : name === "locked"
        ? { onlyLockedDrives: value === true }
        : { pauseRecording: value === true },
  );
  await this.render();
};
RemoteBackupUI.prototype.property = async function (name, property, value) {
  var key = name + "." + property;
  if (this.cache[key] === value) return;
  var c = this.owner.component(name);
  if (!c) return;
  this.cache[key] = value;
  var method = property === "Visible" ? "setVisible" : "setEnabled";
  if (c[method]) await c[method](value);
  else if (c.setProperty) await c.setProperty(property, value ? 1 : 0, "UInt");
};
RemoteBackupUI.prototype.text = async function (name, text, row, cell) {
  cell = cell || "Text";
  var key = name + ".text." + cell + "." + (row || 0),
    value = String(text);
  if (this.cache[key] === value) return;
  var c = this.owner.component(name);
  if (c && c.setValue) {
    await c.setValue(row || 0, cell, value, "Text");
    this.cache[key] = value;
  }
};
RemoteBackupUI.prototype.rows = async function (name, values) {
  var c = this.owner.component(name);
  if (!c) return;
  var count = Math.max(1, values.length);
  if (c.setRowCount && this.cache[name + ".count"] !== count) {
    await c.setRowCount(count);
    this.cache[name + ".count"] = count;
  }
  if (!values.length) values = ["None yet"];
  for (var i = 0; i < values.length; i++)
    await this.text(name, values[i], i, "ItemText");
};
RemoteBackupUI.prototype.render = async function () {
  var timeZone = this.owner.displayTimeZone;
  if (!this.active) return;
  var b = this.backup(),
    configured = b.configured === true,
    wifi = !!(b.wifi && b.wifi.eligible),
    self = this;
  if (this.message === "Requesting Google sign-in code…" && (b.setup || configured || b.message)) this.message = "";
  if (this.page === "account") {
    await this.text("BACKUP_ACCOUNT_TITLE", "Google Drive Backup");
    var setup = b.setup,
      description =
        "Back up original recordings to your own Google Drive.\nWi-Fi only · Originals remain in recording storage.";
    if (setup)
      description =
        "Scan the QR code and sign in to Google.\nEnter this code: " +
        setup.userCode +
        "\n" +
        setup.verificationUrl +
        (setup.expiresAt
          ? " · Expires " +
            new Date(setup.expiresAt).toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
            })
          : "");
    else
      description +=
        "\n" +
        (configured
          ? "Connected: " + b.account
          : "Connect Google once to enable automatic backup.");
    if (!wifi) description += "\nConnect car to Wi-Fi to begin setup";
    if (this.message || b.message)
      description += "\n" + (this.message || b.message);
    await this.text("BACKUP_ACCOUNT_STATUS", description);
    await this.text(
      "BACKUP_BEGIN",
      configured ? "Change Google Account" : "Connect Google Account",
    );
    await this.property("BACKUP_BEGIN", "Enabled", wifi && !setup);
    await this.text("BACKUP_DISCONNECT", "Disconnect Google Account");
    await this.property("BACKUP_DISCONNECT", "Enabled", configured);
    await this.text("BACKUP_CANCEL", "Cancel sign-in");
    await this.property("BACKUP_CANCEL", "Visible", !!setup);
    await this.text("BACKUP_ACCOUNT_BACK", "Back");
    await this.property("BACKUP_ACCOUNT_BACK", "Enabled", true);
    await this.property("BACKUP_QR", "Visible", !!setup);
    if (setup && setup.verificationUrl !== this.qrUrl) {
      try {
        if (
          await this.owner.publishQr(
            setup.verificationUrl,
            "BACKUP_QR",
            "remote-backup-qr.png",
          )
        )
          this.qrUrl = setup.verificationUrl;
      } catch (e) {
        this.message =
          "QR unavailable — open " +
          setup.verificationUrl +
          " and enter the code";
      }
    }
    return;
  }
  await this.text("BACKUP_TITLE", "Remote Backup");
  await this.text("BACKUP_SETUP", "Setup Remote Backup");
  await this.property("BACKUP_SETUP", "Visible", !configured);
  await this.property("BACKUP_SETUP", "Enabled", true);
  await this.text(
    "BACKUP_ACCOUNT",
    "Google Drive · " + (b.account || "Not connected"),
  );
  await this.property("BACKUP_ACCOUNT", "Visible", configured);
  await this.property("BACKUP_ACCOUNT", "Enabled", configured);
  var status = b.state || "Set up Google Drive to enable remote backup";
  if (b.remainingDrives != null)
    status += " · " + b.remainingDrives + " drives remaining";
  if (b.remainingBytes != null)
    status +=
      "\n" + (b.remainingBytes / 1073741824).toFixed(2) + " GB remaining";
  if (b.bytesPerSecond)
    status += " · " + (b.bytesPerSecond / 1048576).toFixed(1) + " MB/s";
  if (Number.isFinite(b.etaSeconds))
    status += " · About " + remainingTime(b.etaSeconds);
  if (b.message) status += "\n" + b.message;
  await this.text("BACKUP_STATUS", status);
  await this.text("BACKUP_AUTO", "Auto Upload on Wi-Fi");
  await this.text("BACKUP_PAUSE", "Pause Recording During Remote Backup");
  await this.property("BACKUP_AUTO", "Enabled", configured);
  await this.property(
    "BACKUP_PAUSE",
    "Enabled",
    configured && b.autoUpload === true,
  );
  await this.text("BACKUP_LOCKED", "Only Backup Locked Drives and Horn Clips");
  await this.property("BACKUP_LOCKED", "Enabled", configured);
  await this.text("BACKUP_STATIONARY", "Do not backup while driving");
  await this.property("BACKUP_STATIONARY", "Enabled", configured);
  var checks = [["BACKUP_AUTO",b.autoUpload],["BACKUP_PAUSE",b.pauseRecording],
    ["BACKUP_LOCKED",b.onlyLockedDrives],["BACKUP_STATIONARY",b.doNotBackupWhileDriving]];
  for (var i = 0; i < checks.length; i++) {
    var checkbox = this.owner.component(checks[i][0]), checked = checks[i][1] === true,
      key = checks[i][0] + ".selected";
    if (checkbox && checkbox.setRowSelected && this.cache[key] !== checked) {
      await checkbox.setRowSelected(0, checked);
      this.cache[key] = checked;
    }
  }
  await this.text("BACKUP_AUTO_HINT", "Automatically back up queued recordings over Wi-Fi.\nCar uploads pause while a phone is connected.");
  await this.text("BACKUP_PAUSE_HINT", "Leaving recording enabled can significantly slow uploads.\nPauses only while stationary; recording resumes when moving.");
  await this.text("BACKUP_STATIONARY_HINT", "When checked, uploads wait until the car is physically stopped.\nWhen unchecked, uploads are allowed at any speed.");
  await this.text("BACKUP_LOCKED_HINT", "Only upload locked drives and horn-protected clips.\nLock recordings under Recording storage → Recorded Drives.");
  var drives = b.drives || [],
    completed = (b.completed || []).slice(0, 5);
  await this.text("BACKUP_QUEUE_HEADING", "Upload Queue");
  var lastPage = Math.max(0, Math.ceil(drives.length / 5) - 1);
  this.drivePage = Math.max(0, Math.min(this.drivePage, lastPage));
  var base = this.drivePage * 5;
  await this.text("BACKUP_PREVIOUS_DRIVES", "Previous drives");
  await this.text("BACKUP_NEXT_DRIVES", "More drives");
  await this.property("BACKUP_PREVIOUS_DRIVES", "Visible", configured && this.drivePage > 0);
  await this.property("BACKUP_PREVIOUS_DRIVES", "Enabled", configured && this.drivePage > 0);
  await this.property("BACKUP_NEXT_DRIVES", "Visible", configured && this.drivePage < lastPage);
  await this.property("BACKUP_NEXT_DRIVES", "Enabled", configured && this.drivePage < lastPage);
  await this.text("BACKUP_SLEEP_NOTICE",
    "Your car sleeps automatically after locking (around 5–15 min; timing varies).\n" +
    "Uploads may not finish after you exit. They resume when the car is awake and connected to Wi-Fi again.");
  for (var n = 0; n < 5; n++) {
    var d = drives[base + n],
      label = "BACKUP_DRIVE_" + n,
      bar = "BACKUP_PROGRESS_" + n;
    await this.property(label, "Visible", !!d);
    await this.property(bar, "Visible", !!d);
    if (d) {
      await this.text(
        label,
        date(d.startedAt, timeZone) +
          " · " +
          d.verifiedClips +
          "/" +
          d.totalClips +
          " clips · " +
          d.state + " " + Math.floor(Math.max(0, Math.min(1, d.progress || 0)) * 100) + "%",
      );
      var progress = this.owner.component(bar);
      var pct =
        Math.round(Math.max(0, Math.min(1, d.progress || 0)) * 1000) / 1000;
      if (
        progress &&
        progress.setProgress &&
        this.cache[bar + ".progress"] !== pct
      ) {
        await progress.setProgress(pct);
        this.cache[bar + ".progress"] = pct;
      }
    }
  }
  await this.rows(
    "BACKUP_HISTORY",
    completed.map(function (d) {
      return date(d.startedAt, timeZone) + " · Uploaded " + date(d.completedAt, timeZone);
    }),
  );
  await this.property(
    "BACKUP_HISTORY",
    "Enabled",
    configured && completed.length > 0,
  );
  await this.text("BACKUP_BACK", "Back");
  await this.property("BACKUP_BACK", "Enabled", true);
};
module.exports = { RemoteBackupUI: RemoteBackupUI };
