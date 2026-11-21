"use strict";
var setupState = require("./setup-state"),
  preference = require("./recording-preference"),
  fs = require("fs"),
  path = require("path"),
  crypto = require("crypto");
function uid() {
  return process.getuid();
}
function directory(dir) {
  var s = fs.lstatSync(dir);
  if (
    !s.isDirectory() ||
    s.isSymbolicLink() ||
    s.uid !== uid() ||
    (s.mode & 511) !== 448
  )
    throw new Error("Unsafe recorder RAM directory");
}
function check(file) {
  try {
    var s = fs.lstatSync(file);
    if (
      !s.isFile() ||
      s.isSymbolicLink() ||
      s.uid !== uid() ||
      (s.mode & 511) !== 384 ||
      s.size > 65536
    )
      throw new Error("Unsafe recorder RAM file");
    return s;
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
function read(file) {
  if (!check(file)) return {};
  var value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid recorder data");
  return value;
}
function Recording(dir, preferenceDirectory) {
  directory(dir);
  this.directory = dir;
  this.preferenceDirectory = preferenceDirectory || preference.location(uid());
  this.controlFile = path.join(dir, "recorder-control.json");
  this.statusFile = path.join(dir, "recorder-status.json");
}
Recording.prototype.read = function () {
  try {
    directory(this.directory);
    var s = read(this.statusFile), pending = setupState.read();
    if (pending) Object.keys(pending).forEach(function (k) { s[k] = pending[k]; });
    if (!s.state) s.state = "Starting recorder";
    if (!Array.isArray(s.drives)) s.drives = [];
    return s;
  } catch (e) {
    return { state: "Recorder unavailable", error: e.message, drives: [] };
  }
};
Recording.prototype.intent = function () {
  try {
    directory(this.directory);
    var current = preference.controls(read(this.controlFile)), saved = preference.read(this.preferenceDirectory, uid()), savedLimit=preference.readLimit(this.preferenceDirectory,uid());
    if (saved !== undefined) current.continuous = saved;
    if (savedLimit !== undefined) current.internalStorageLimitBytes = savedLimit;
    if (!preference.validInternalLimit(current.internalStorageLimitBytes)) current.internalStorageLimitBytes=preference.DEFAULT_INTERNAL_LIMIT;
    if (typeof current.continuous !== 'boolean') current.continuous = false;
  } catch (e) {
    current = { continuous: false };
  }
  return current;
};
Recording.prototype.update = function (patch) {
  directory(this.directory);
  var current = preference.controls(read(this.controlFile));
  patch = preference.controls(patch);
  if (Object.prototype.hasOwnProperty.call(patch,'internalStorageLimitBytes')&&!preference.validInternalLimit(patch.internalStorageLimitBytes)) throw new Error('Invalid internal storage limit');
  if (Object.prototype.hasOwnProperty.call(patch, 'continuous')) {
    preference.write(this.preferenceDirectory, uid(), patch.continuous);
    patch.recordingAction = crypto.randomBytes(16).toString('hex');
  }
  Object.keys(patch).forEach(function (k) {
    current[k] = patch[k];
  });
  var body = JSON.stringify(current);
  if (Buffer.byteLength(body) > 8192)
    throw new Error("Recorder control too large");
  var tmp = this.controlFile + ".tmp-" + crypto.randomBytes(8).toString("hex"),
    fd = fs.openSync(tmp, "wx", 384);
  try {
    fs.writeFileSync(fd, body);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    directory(this.directory);
    check(this.controlFile);
    fs.renameSync(tmp, this.controlFile);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  return current;
};
module.exports = { Recording: Recording };
