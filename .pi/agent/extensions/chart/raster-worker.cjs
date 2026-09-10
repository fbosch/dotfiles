const { parentPort } = require("node:worker_threads");
const Module = require("node:module");
const { dirname, resolve } = require("node:path");

function loadResvg() {
  const resolveFilename = Module._resolveFilename;
  // Pi ships compiled Bun 1.3.13, which cannot resolve a package main ending in
  // .node. Resolve that main explicitly, leaving resvg to choose the platform.
  // Keep the hook inside this worker and restore it immediately after loading.
  if (process.versions.bun) {
    Module._resolveFilename = function (name, parent, ...options) {
      if (/^@resvg\/resvg-js-[^/]+$/.test(name)) {
        const metadata = resolveFilename.call(this, `${name}/package.json`, parent, ...options);
        return resolve(dirname(metadata), require(metadata).main);
      }
      return resolveFilename.call(this, name, parent, ...options);
    };
  }
  try {
    return require("@resvg/resvg-js");
  } finally {
    Module._resolveFilename = resolveFilename;
  }
}

const { Resvg } = loadResvg();

// Plain CommonJS: Pi's jiti loader does not install a TypeScript loader in workers.
parentPort.on("message", ({ svg, font, cancelled, maxPngBytes }) => {
  const obsolete = () => Atomics.load(cancelled, 0) !== 0;
  try {
    if (obsolete()) return parentPort.postMessage({});
    const image = new Resvg(svg, { font }).render();
    if (obsolete()) return parentPort.postMessage({});
    const png = image.asPng();
    if (obsolete()) return parentPort.postMessage({});
    if (png.byteLength > maxPngBytes) throw new Error("chart PNG exceeded the resource limit");
    const base64 = png.toString("base64");
    parentPort.postMessage(obsolete() ? {} : { base64 });
  } catch (error) {
    parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
});
