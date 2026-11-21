"use strict";
var fs=require("fs"),path=require("path"),crypto=require("crypto");
var bytes=fs.readFileSync(path.join(__dirname,"store-package.tgz"));
if(crypto.createHash("sha256").update(bytes).digest("hex")!=="356f996968adffb59e5a76b452abc7e7614373dc6e6d64cd204980b916699296")throw Error("BimmerVision package checksum mismatch");
fs.writeFileSync(path.join(__dirname,"store-output.tgz"),bytes);
