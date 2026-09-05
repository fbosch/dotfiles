import { describe, expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fetchWebContent, htmlToMarkdown, htmlToText, isBlockedAddress } from "..";

const PUBLIC_ADDRESSES = async () => ["93.184.216.34"];

describe("webfetch", () => {
  test("blocks local and private destinations", async () => {
    expect(isBlockedAddress("127.0.0.1")).toBe(true);
    expect(isBlockedAddress("10.0.0.1")).toBe(true);
    expect(isBlockedAddress("::1")).toBe(true);
    expect(isBlockedAddress("fec0::1")).toBe(true);
    expect(isBlockedAddress("2002:7f00:1::")).toBe(true);
    expect(isBlockedAddress("0:0:0:0:0:ffff:7f00:1")).toBe(true);
    expect(isBlockedAddress("93.184.216.34")).toBe(false);

    await rejects(
      fetchWebContent({ url: "http://127.0.0.1/private" }),
      /Private or reserved IP addresses/,
    );
  });

  test("validates redirect destinations before following them", async () => {
    let calls = 0;
    const requestFn = async () => {
      calls += 1;
      return new Response(null, {
        status: 302,
        headers: { Location: "https://169.254.169.254/latest/meta-data" },
      });
    };

    await rejects(
      fetchWebContent({ url: "https://example.com" }, undefined, {
        requestFn,
        resolveHostname: PUBLIC_ADDRESSES,
      }),
      /Private or reserved IP addresses/,
    );
    expect(calls).toBe(1);
  });

  test("converts HTML to markdown and resolves links", async () => {
    const requestFn = async () => {
      return new Response(
        "<html><body><script>ignore()</script><h1>Title</h1><p>Hello <strong>world</strong>.</p><a href='/docs'>Docs</a></body></html>",
        { headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    };

    const result = await fetchWebContent(
      { url: "https://example.com/start", format: "markdown" },
      undefined,
      { requestFn, resolveHostname: PUBLIC_ADDRESSES },
    );

    expect(result.content[0]).toEqual({
      type: "text",
      text: "# Title\n\nHello **world**.\n\n[Docs](https://example.com/docs)",
    });
  });

  test("supports plain-text extraction and standalone conversion", () => {
    const html = "<style>hidden</style><p>First&nbsp;line</p><p>Second line</p>";
    expect(htmlToText(html)).toBe("First line\nSecond line");
    expect(htmlToText('<p title="1 > 0">Hello</p>')).toBe("Hello");
    expect(htmlToText("<script>secret()")).toBe("");
    expect(htmlToText("<html><head><title>x</title><body><p>Hello</p></body></html>")).toBe(
      "Hello",
    );
    expect(htmlToMarkdown("<h2>Heading</h2><ul><li>One</li><li>Two</li></ul>")).toBe(
      "## Heading\n\n- One\n- Two",
    );
  });

  test("malformed anchor attributes cannot hang the process", () => {
    // Isolate the synchronous parser so a regression is killed rather than hanging the suite.
    const script = `
      import { htmlToMarkdown } from ${JSON.stringify(new URL("../index.ts", import.meta.url).href)};
      const html = ${JSON.stringify('<a ">">text</a><a " > " href="/ignored">more</a>')};
      console.log(htmlToMarkdown(html, new URL("https://example.com"), performance.now() + 500));
    `;
    const result = spawnSync(process.execPath, ["--eval", script], {
      encoding: "utf8",
      killSignal: "SIGKILL",
      timeout: 2_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("textmore");
  });

  test("preserves valid attributes with quoted greater-than signs", () => {
    expect(
      htmlToMarkdown('<a title=">" hidden href="/docs">Docs</a>', new URL("https://example.com")),
    ).toBe("[Docs](https://example.com/docs)");
  });

  test("stops conversion after its deadline", () => {
    expect(() =>
      htmlToMarkdown('<a href="/docs">Docs</a>', new URL("https://example.com"), -1),
    ).toThrow("Request timed out");
  });

  test("returns supported images to the model", async () => {
    const requestFn = async () => {
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "Content-Type": "image/png" },
      });
    };

    const result = await fetchWebContent({ url: "https://example.com/image.png" }, undefined, {
      requestFn,
      resolveHostname: PUBLIC_ADDRESSES,
    });

    expect(result.content[1]).toEqual({ type: "image", data: "AQID", mimeType: "image/png" });
  });

  test("rejects declared responses over the size limit", async () => {
    const requestFn = async () => {
      return new Response("small", {
        headers: { "Content-Type": "text/plain", "Content-Length": String(6 * 1024 * 1024) },
      });
    };

    await rejects(
      fetchWebContent({ url: "https://example.com/large" }, undefined, {
        requestFn,
        resolveHostname: PUBLIC_ADDRESSES,
      }),
      /Response too large/,
    );
  });

  test("pins each request to the validated DNS result", async () => {
    let connectedAddresses: readonly string[] = [];
    const requestFn = async (_url: URL, addresses: readonly string[]) => {
      connectedAddresses = addresses;
      return new Response("ok", { headers: { "Content-Type": "text/plain" } });
    };

    await fetchWebContent({ url: "https://example.com" }, undefined, {
      requestFn,
      resolveHostname: PUBLIC_ADDRESSES,
    });

    expect(connectedAddresses).toEqual(["93.184.216.34"]);
  });

  test("rejects HTTPS downgrades", async () => {
    const requestFn = async () => {
      return new Response(null, {
        status: 302,
        headers: { Location: "http://example.com/insecure" },
      });
    };

    await rejects(
      fetchWebContent({ url: "https://example.com" }, undefined, {
        requestFn,
        resolveHostname: PUBLIC_ADDRESSES,
      }),
      /HTTPS redirects to HTTP/,
    );
  });

  test("bounds DNS resolution by the requested timeout", async () => {
    const resolveHostname = () => new Promise<readonly string[]>(() => undefined);
    await rejects(
      fetchWebContent({ url: "https://example.com", timeout: 1 }, undefined, { resolveHostname }),
      Error,
    );
  });

  test("converts hostile unclosed tags in linear time", () => {
    const html = '<a href="https://example.com">'.repeat(32_000);
    expect(htmlToMarkdown(html)).toHaveLength(32_000);
  });

  test("truncates text without splitting a Unicode code point", async () => {
    const requestFn = async () => {
      return new Response(`a${"😀".repeat(100_001)}`, {
        headers: { "Content-Type": "text/plain" },
      });
    };
    const result = await fetchWebContent({ url: "https://example.com" }, undefined, {
      requestFn,
      resolveHostname: PUBLIC_ADDRESSES,
    });
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    const truncated = text.split("\n\n[Truncated", 1)[0] ?? "";
    const lastCodeUnit = truncated.charCodeAt(truncated.length - 1);
    expect(lastCodeUnit < 0xd800 || lastCodeUnit > 0xdbff).toBe(true);
    expect(result.details.truncated).toBe(true);
  });
});
