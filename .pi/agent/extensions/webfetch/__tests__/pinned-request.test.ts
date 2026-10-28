import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

const transport = new URL("../pinned-request.ts", import.meta.url).href;

describe("pinned requests under Node", () => {
  for (const status of [200, 204]) {
    test(`pinned HTTP response ${status} preserves status, headers and body`, () => {
      const source = `
        import assert from "node:assert/strict";
        import { createServer } from "node:http";
        import { once } from "node:events";
        import { requestPinnedUrl } from ${JSON.stringify(transport)};
        const server = createServer((request, response) => {
          assert.equal(request.headers.host, "research.example:" + server.address().port);
          response.writeHead(${status}, { "content-type": "text/plain", "x-fixture": "pinned" });
          response.end("research result");
        });
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        try {
          const response = await requestPinnedUrl(
            new URL("http://research.example:" + server.address().port + "/"),
            ["127.0.0.1"], {}, AbortSignal.timeout(2000),
          );
          assert.equal(response.status, ${status});
          assert.equal(response.headers.get("x-fixture"), "pinned");
          assert.equal(await response.text(), ${status} === 204 ? "" : "research result");
          console.log("response handled");
        } finally {
          await new Promise(resolve => server.close(resolve));
        }
      `;
      const result = spawnSync("node", ["--input-type=module", "--eval", source], {
        encoding: "utf8",
        timeout: 5000,
      });
      expect(result.error).toBeUndefined();
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("response handled");
    });
  }

  for (const protocol of ["http:", "https:"]) {
    for (const addresses of [["192.0.2.1"], ["192.0.2.1", "192.0.2.2"]]) {
      test(`${protocol} connection denial with ${addresses.length} addresses rejects without crashing`, () => {
        const source = `
          import assert from "node:assert/strict";
          import { requestPinnedUrl } from ${JSON.stringify(transport)};
          // Simulate synchronous kernel EPERM without opening a real network connection.
          const { TCP } = process.binding("tcp_wrap");
          TCP.prototype.connect = TCP.prototype.connect6 = () => -1;
          const error = await requestPinnedUrl(
            new URL("${protocol}//research.example/"),
            ${JSON.stringify(addresses)},
            {},
            AbortSignal.timeout(2000),
          ).then(() => { throw new Error("Expected connection denial"); }, error => error);
          assert.equal(error.code, "EPERM");
          console.log("denial handled");
        `;
        const result = spawnSync("node", ["--input-type=module", "--eval", source], {
          encoding: "utf8",
          timeout: 5000,
        });
        expect(result.error).toBeUndefined();
        expect(result.stderr).toBe("");
        expect(result.status).toBe(0);
        expect(result.stdout.trim()).toBe("denial handled");
      });
    }
  }
});
