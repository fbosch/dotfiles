const Module = require("node:module");
const { isMainThread } = require("node:worker_threads");
const originalLoad = Module._load;
const block = () => {
  const until = performance.now() + 200;
  while (performance.now() < until) {}
};

// Deterministic CPU-bound stages catch accidentally moving any stage back to Pi's thread.
Module._load = function (id, ...args) {
  if (id !== "@resvg/resvg-js") return originalLoad.call(this, id, ...args);
  if (isMainThread) throw new Error("resvg loaded on the main thread");
  return {
    Resvg: class {
      constructor(svg) {
        this.oversized = svg === "oversized";
        if (svg === "exit") process.exit(7);
      }
      render() {
        block();
        const oversized = this.oversized;
        return {
          asPng() {
            block();
            return {
              byteLength: oversized ? 4 * 1024 * 1024 + 1 : 8,
              toString() {
                if (oversized) throw new Error("oversized PNG reached base64 conversion");
                block();
                return "cG5n";
              },
            };
          },
        };
      }
    },
  };
};
