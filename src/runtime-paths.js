const os = require("node:os");
const path = require("node:path");

function isVercelRuntime() {
  return Boolean(process.env.VERCEL);
}

function writableRoot() {
  return isVercelRuntime()
    ? path.join(os.tmpdir(), "instagram-carousel-mvp")
    : process.cwd();
}

function dataRoot() {
  return path.join(writableRoot(), "data");
}

function outputRoot() {
  return path.join(writableRoot(), "output");
}

function postOutputDirectory(id) {
  return path.join(outputRoot(), String(id));
}

module.exports = { isVercelRuntime, writableRoot, dataRoot, outputRoot, postOutputDirectory };
