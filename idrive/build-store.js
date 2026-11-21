"use strict";
var fs=require("fs"),path=require("path"),crypto=require("crypto");
var bytes=fs.readFileSync(path.join(__dirname,"store-package.tgz"));
if(crypto.createHash("sha256").update(bytes).digest("hex")!=="d11106a4993adf47c478689d740761b601e2185926dfaf28aa14e8e8b4724f1a")throw Error("BimmerVision package checksum mismatch");
fs.writeFileSync(path.join(__dirname,"store-output.tgz"),bytes);
