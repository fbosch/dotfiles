import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionToolContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Resvg } from "@resvg/resvg-js";
import { Value } from "typebox/value";
import { loadExtensions } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";
import { executeCodemode } from "../../node_modules/@earendil-works/pi-coding-agent/dist/extensions/codemode/execute.js";
import { applyPiPatches } from "../pi-npm";

const agentRoot = resolve(import.meta.dir, "../..");
let workspace: string;
let readTool: ToolDefinition;

beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), "pi-hashline-image-package-"));
  const installRoot = join(workspace, "runtime");
  const packageRoot = join(installRoot, "node_modules/pi-hashline-edit-pro");
  cpSync(join(agentRoot, "npm/node_modules/pi-hashline-edit-pro"), packageRoot, {
    recursive: true,
  });
  symlinkSync(join(agentRoot, "npm/node_modules"), join(packageRoot, "node_modules"));
  symlinkSync(join(agentRoot, "node_modules"), join(workspace, "node_modules"));
  writeFileSync(join(installRoot, "package.json"), '{"private":true}\n');
  // Exercise the tracked patch and content gate without mutating installed packages.
  expect(applyPiPatches(installRoot, false)).toBe(0);
  expect(applyPiPatches(installRoot, false)).toBe(0);
  const loaded = await loadExtensions([join(packageRoot, "index.ts")], agentRoot);
  expect(loaded.errors).toEqual([]);
  const tool = loaded.extensions[0]?.tools.get("read")?.definition;
  if (!tool) throw new Error("Hashline read tool failed to load");
  readTool = tool;
});

afterAll(() => {
  if (workspace) rmSync(workspace, { recursive: true, force: true });
});

const png = new Resvg(
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="red"/></svg>',
)
  .render()
  .asPng();

function contextFor(cwd: string): ExtensionToolContext {
  const ctx = {
    cwd,
    tools: [readTool],
    sessionManager: { getBranch: () => [] },
    async executeTool(name: string, args: Record<string, unknown>) {
      if (name !== "read") throw new Error(`Unexpected tool ${name}`);
      const result = await readTool.execute("nested-read", args, undefined, undefined, ctx);
      return {
        toolCall: { id: "nested-read", type: "toolCall", name, arguments: args },
        result,
        isError: "isError" in result && result.isError === true,
      };
    },
  } as unknown as ExtensionToolContext;
  return ctx;
}

async function withImage(run: (ctx: ExtensionToolContext) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), "pi-hashline-image-test-"));
  try {
    writeFileSync(join(directory, "pixel.png"), png);
    await run(contextFor(directory));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("pi-hashline-edit-pro structured image reads", () => {
  test("returns the attached image payload and note in its declared schema", async () => {
    await withImage(async (ctx) => {
      const result = await readTool.execute(
        "image-read",
        { path: "pixel.png" },
        undefined,
        undefined,
        ctx,
      );
      const attached = result.content.find((block) => block.type === "image");
      expect(attached).toBeDefined();
      if (attached?.type !== "image") throw new Error("Image attachment missing");
      expect(result.structuredContent).toEqual({
        ok: true,
        kind: "image",
        path: "pixel.png",
        type: "image",
        data: attached.data,
        mimeType: attached.mimeType,
        note: result.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n"),
      });
      expect(attached.data.length).toBeGreaterThan(0);
      if (!readTool.outputSchema) throw new Error("Output schema missing");
      expect(Value.Check(readTool.outputSchema, result.structuredContent)).toBe(true);
      const { data: _data, ...metadataOnly } = result.structuredContent as Record<string, unknown>;
      expect(Value.Check(readTool.outputSchema, metadataOnly)).toBe(false);
    });
  });

  test("uses the processed MIME type when a BMP is converted to PNG", async () => {
    await withImage(async (ctx) => {
      // A 1x1, 24-bit BMP makes format conversion observable without external fixtures.
      const bmp = Buffer.alloc(58);
      bmp.write("BM");
      bmp.writeUInt32LE(58, 2);
      bmp.writeUInt32LE(54, 10);
      bmp.writeUInt32LE(40, 14);
      bmp.writeInt32LE(1, 18);
      bmp.writeInt32LE(1, 22);
      bmp.writeUInt16LE(1, 26);
      bmp.writeUInt16LE(24, 28);
      bmp.writeUInt32LE(4, 34);
      bmp[56] = 255;
      writeFileSync(join(ctx.cwd, "pixel.bmp"), bmp);
      const result = await readTool.execute(
        "converted-image",
        { path: "pixel.bmp" },
        undefined,
        undefined,
        ctx,
      );
      const attached = result.content.find((block) => block.type === "image");
      expect(attached).toBeDefined();
      if (attached?.type !== "image") throw new Error("Converted image missing");
      expect(result.structuredContent).toMatchObject({
        type: "image",
        data: attached.data,
        mimeType: "image/png",
        note: expect.stringContaining("converted from image/bmp to image/png"),
      });
    });
  });

  test("returns a structured error when processing omits the image", async () => {
    await withImage(async (ctx) => {
      writeFileSync(
        join(ctx.cwd, "broken.png"),
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
          "base64",
        ),
      );
      const result = await readTool.execute(
        "broken-image",
        { path: "broken.png" },
        undefined,
        undefined,
        ctx,
      );
      expect(result.content.some((block) => block.type === "image")).toBe(false);
      if (!readTool.outputSchema) throw new Error("Output schema missing");
      expect(Value.Check(readTool.outputSchema, result.structuredContent)).toBe(true);
      expect(result.structuredContent).toMatchObject({
        ok: false,
        kind: "error",
        error: { code: "E_IMAGE_READ", message: expect.stringContaining("Image omitted") },
      });
      expect("isError" in result && result.isError).toBe(true);
    });
  });

  test("emits the image through native codemode image(await tools.read(...))", async () => {
    await withImage(async (ctx) => {
      const result = await executeCodemode(
        "codemode-image",
        { code: 'const value = await tools.read({ path: "pixel.png" }); image(value);' },
        undefined,
        undefined,
        ctx,
      );
      const output = result.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      expect(output).toContain("Script completed");
      expect(output).not.toContain("Script error:");
      const emitted = result.content.find((block) => block.type === "image");
      expect(emitted).toBeDefined();
      if (emitted?.type !== "image") throw new Error("Codemode image missing");
      expect(emitted.mimeType).toBe("image/png");
      expect(emitted.data).toBe(Buffer.from(png).toString("base64"));
    });
  });
});
