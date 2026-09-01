import { describe, expect, test } from "bun:test";
import { fetchWebContent, htmlToMarkdown, htmlToText, isBlockedAddress } from "../webfetch";

const PUBLIC_ADDRESSES = async () => ["93.184.216.34"];

describe("webfetch", () => {
  test("blocks local and private destinations", async () => {
    expect(isBlockedAddress("127.0.0.1")).toBe(true);
    expect(isBlockedAddress("10.0.0.1")).toBe(true);
    expect(isBlockedAddress("::1")).toBe(true);
    expect(isBlockedAddress("93.184.216.34")).toBe(false);

    await expect(fetchWebContent({ url: "http://127.0.0.1/private" })).rejects.toThrow(
      "Private or reserved IP addresses",
    );
  });

  test("validates redirect destinations before following them", async () => {
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      return new Response(null, {
        status: 302,
        headers: { Location: "http://169.254.169.254/latest/meta-data" },
      });
    };

    await expect(
      fetchWebContent({ url: "https://example.com" }, undefined, {
        fetchFn,
        resolveHostname: PUBLIC_ADDRESSES,
      }),
    ).rejects.toThrow("Private or reserved IP addresses");
    expect(calls).toBe(1);
  });

  test("converts HTML to markdown and resolves links", async () => {
    const fetchFn = async () => {
      return new Response(
        "<html><body><script>ignore()</script><h1>Title</h1><p>Hello <strong>world</strong>.</p><a href='/docs'>Docs</a></body></html>",
        { headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    };

    const result = await fetchWebContent(
      { url: "https://example.com/start", format: "markdown" },
      undefined,
      { fetchFn, resolveHostname: PUBLIC_ADDRESSES },
    );

    expect(result.content[0]).toEqual({
      type: "text",
      text: "# Title\n\nHello **world**.\n\n[Docs](https://example.com/docs)",
    });
  });

  test("supports plain-text extraction and standalone conversion", () => {
    const html = "<style>hidden</style><p>First&nbsp;line</p><p>Second line</p>";
    expect(htmlToText(html)).toBe("First line\nSecond line");
    expect(htmlToMarkdown("<h2>Heading</h2><ul><li>One</li><li>Two</li></ul>")).toBe(
      "## Heading\n\n- One\n- Two",
    );
  });

  test("returns supported images to the model", async () => {
    const fetchFn = async () => {
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "Content-Type": "image/png" },
      });
    };

    const result = await fetchWebContent({ url: "https://example.com/image.png" }, undefined, {
      fetchFn,
      resolveHostname: PUBLIC_ADDRESSES,
    });

    expect(result.content[1]).toEqual({ type: "image", data: "AQID", mimeType: "image/png" });
  });

  test("rejects declared responses over the size limit", async () => {
    const fetchFn = async () => {
      return new Response("small", {
        headers: { "Content-Type": "text/plain", "Content-Length": String(6 * 1024 * 1024) },
      });
    };

    await expect(
      fetchWebContent({ url: "https://example.com/large" }, undefined, {
        fetchFn,
        resolveHostname: PUBLIC_ADDRESSES,
      }),
    ).rejects.toThrow("Response too large");
  });
});
