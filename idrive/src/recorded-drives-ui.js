"use strict";
var crypto = require("crypto"),
  Controls = require("./remote-backup-ui").RemoteBackupUI;
var date = require("./drive-time").format;

function RecordedDrivesUI(owner) {
  this.owner = owner;
  this.active = false;
  this.selectedId = null;
  this.cache = {};
  this.pendingId = null;
  this.refreshNeeded = true;
  this.observedVolume = null;
  this.pendingSince = 0;
}
RecordedDrivesUI.prototype.text = Controls.prototype.text;
RecordedDrivesUI.prototype.rows = Controls.prototype.rows;
RecordedDrivesUI.prototype.property = Controls.prototype.property;
RecordedDrivesUI.prototype.canAct = function () {
  return this.active && !this.owner.closed && this.owner.visible !== false;
};
RecordedDrivesUI.prototype.view = function () {
  var desk = this.owner.desk(),
    view = desk.recordedDrives || {
      drives: [],
      page: 0,
      pageCount: 1,
      total: 0,
    };
  return {
    desk: desk,
    data: view,
    current:
      !!desk.drive &&
      !!desk.volumeToken &&
      desk.volumeToken === view.volumeToken,
  };
};
RecordedDrivesUI.prototype.send = function (action, fields) {
  var c = {
    id: crypto.randomBytes(16).toString("hex"),
    action: action,
    volumeToken: this.owner.desk().volumeToken,
  };
  Object.assign(c, fields);
  this.pendingId = c.id;
  this.pendingSince = Date.now();
  this.refreshNeeded = false;
  var desk = this.owner.desk();
  this.libraryCounts = JSON.stringify([desk.recordingCount, desk.lockedRecordingCount]);
  this.owner.update({ driveCommand: c });
};
RecordedDrivesUI.prototype.initialize = function () {
  var self = this,
    o = this.owner;
  function bind(name, event, fn) {
    o.listen(o.component(name), event, function (e) {
      if (!self.canAct()) return;
      Promise.resolve(fn(e)).catch(function () {
        self.refreshNeeded = true;
      });
    });
  }
  bind("DRIVES_LIST", "action", function (e) {
    var v = self.view();
    if (!v.current || v.data.busy || self.pendingId) return;
    var d = (v.data.drives || [])[e.row];
    if (d) self.selectedId = d.id;
    return self.render();
  });
  bind("DRIVES_LOCK", "change", function (e) {
    return self.lock(e.selected);
  });
  bind("DRIVES_COPY", "action", async function () {
    var v=self.view(),drive=(v.data.drives||[]).filter(function(d){return d.id===self.selectedId;})[0];
    if(!v.current||v.data.busy||self.pendingId||!drive)return;
    await o.beginCopyFromDrive(drive);
  });
  bind("DRIVES_OLDER", "action", function () {
    return self.page(1);
  });
  bind("DRIVES_NEWER", "action", function () {
    return self.page(-1);
  });
  bind("DRIVES_BACK", "action", async function () {
    self.active = false;
    self.pendingId = null;
    await o.openNativePage("usb", "USB_STORAGE");
    await o.render();
  });
};
RecordedDrivesUI.prototype.open = async function () {
  this.active = true;
  this.owner.nativePage = null;
  this.selectedId = null;
  this.pendingId = null;
  this.cache = {};
  this.observedVolume = this.owner.desk().volumeToken;
  if (this.owner.backupUI) this.owner.backupUI.active = false;
  var c = this.owner.component("RECORDED_DRIVES");
  if (c && c.updateResources) await c.updateResources();
  await this.owner.rhmi.openState("RECORDED_DRIVES");
  this.owner.visible = true;
  this.send("list", { page: 0 });
  await this.render();
};
RecordedDrivesUI.prototype.page = async function (delta) {
  if (!this.canAct()) return;
  var v = this.view(),
    page = v.data.page + delta;
  if (
    !v.current ||
    v.data.busy ||
    this.pendingId ||
    page < 0 ||
    page >= v.data.pageCount
  )
    return;
  this.selectedId = null;
  this.send("list", { page: page });
  await this.render();
};
RecordedDrivesUI.prototype.lock = async function (locked) {
  delete this.cache["DRIVES_LOCK.selected"];
  var v = this.view(),
    drive = (v.data.drives || []).filter(function (d) {
      return d.id === this.selectedId;
    }, this)[0];
  if (
    !this.canAct() ||
    !v.current ||
    v.data.busy ||
    this.pendingId ||
    !drive ||
    typeof locked !== "boolean"
  ) {
    await this.render();
    return;
  }
  this.send("lock", {
    driveId: drive.id,
    membership: drive.membership,
    locked: locked,
    page: v.data.page,
  });
  await this.render();
};
RecordedDrivesUI.prototype.render = async function () {
  var timeZone = this.owner.displayTimeZone;
  if (!this.canAct()) return;
  var v = this.view(),
    data = v.data;
  if (this.observedVolume !== v.desk.volumeToken) {
    this.observedVolume = v.desk.volumeToken;
    this.pendingId = null;
    this.selectedId = null;
    this.refreshNeeded = true;
    this.cache = {};
  }
  if (this.pendingId && !data.busy && Date.now() - this.pendingSince > 10000) {
    this.pendingId = null;
    this.refreshNeeded = true;
  }
  if (this.pendingId && data.commandId === this.pendingId && !data.busy)
    this.pendingId = null;
  if (!v.current) this.selectedId = null;
  if (
    !this.pendingId &&
    !data.busy &&
    v.desk.volumeToken &&
    (this.refreshNeeded ||
      this.libraryCounts !== JSON.stringify([v.desk.recordingCount, v.desk.lockedRecordingCount]))
  )
    this.send("list", { page: data.page || 0 });
  var drives = v.current ? data.drives || [] : [],
    selected = drives.filter(function (d) {
      return d.id === this.selectedId;
    }, this)[0];
  if (!selected && drives.length) {
    selected = drives[0];
    this.selectedId = selected.id;
  }
  await this.text("DRIVES_TITLE", "Recorded Drives");
  await this.rows(
    "DRIVES_LIST",
    drives.map(function (d) {
      return (
        date(d.startedAt, timeZone) +
        " · " +
        d.totalClips +
        " clips · " +
        (d.locked ? "Locked" : d.mixed ? "Partly locked" : "Unlocked")
      );
    }),
  );
  // The SDK suppresses repeated change events for its last row; action always
  // carries the selected row, including after programmatic selection updates.
  var selector = this.owner.component("DRIVES_LIST"),
    row = selected ? drives.indexOf(selected) : 0;
  if (
    selector &&
    selector.setValue &&
    this.cache["DRIVES_LIST.selected"] !== row
  ) {
    await selector.setValue("SelectedItem", row, "UInt");
    this.cache["DRIVES_LIST.selected"] = row;
  }
  var ready = v.current && !data.busy && !this.pendingId;
  await this.property("DRIVES_LIST", "Enabled", ready && drives.length > 0);
  await this.text("DRIVES_LOCK", "Lock this drive");
  await this.property("DRIVES_LOCK", "Enabled", ready && !!selected);
  await this.text("DRIVES_COPY", "Copy this drive…");
  await this.property("DRIVES_COPY", "Enabled", ready && !!selected);
  var checked = !!(selected && selected.locked),
    checkbox = this.owner.component("DRIVES_LOCK");
  if (
    checkbox &&
    checkbox.setRowSelected &&
    this.cache["DRIVES_LOCK.selected"] !== checked
  ) {
    await checkbox.setRowSelected(0, checked);
    this.cache["DRIVES_LOCK.selected"] = checked;
  }
  var status = !v.desk.drive
    ? "Select recording storage"
    : !v.current
      ? "Loading recorded drives…"
      : data.busy || this.pendingId
        ? "Updating recorded drives…"
        : data.message ||
          (!drives.length && "No completed drives in this storage") ||
          "Newest drives first · " + data.total + " drives";
  if (selected)
    status +=
      "\n" +
      date(selected.startedAt, timeZone) +
      " · " +
      selected.totalClips +
      " clips · " +
      selected.lockedClips +
      " locked";
  await this.text("DRIVES_STATUS", status);
  await this.text(
    "DRIVES_HINT",
    "Lock/unlock the selected drive group.\nCopy it elsewhere without deleting the original.\nRemote Backup can upload locked groups only.",
  );
  await this.text("DRIVES_OLDER", "Older drives");
  await this.text("DRIVES_NEWER", "Newer drives");
  await this.property(
    "DRIVES_OLDER",
    "Enabled",
    ready && data.page + 1 < data.pageCount,
  );
  await this.property("DRIVES_NEWER", "Enabled", ready && data.page > 0);
  await this.text("DRIVES_BACK", "Back");
  await this.property("DRIVES_BACK", "Enabled", true);
};
module.exports = { RecordedDrivesUI: RecordedDrivesUI };
