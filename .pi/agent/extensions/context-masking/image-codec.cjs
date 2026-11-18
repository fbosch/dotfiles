// Plain CommonJS keeps the decoder independent of Pi's TypeScript/Jiti loader.
const { createInterface } = require("node:readline");
const DECODE_TIMEOUT_SECONDS = 12;

async function decode(sharp, input, mimeType, limits) {
  if (!input.length || input.length > limits.maxImageBytes) throw new Error("Image input exceeded its byte limit");
  if (mimeType !== "image/png" && mimeType !== "image/jpeg") throw new Error("Unsupported image MIME type");
  if (mimeType === "image/png") {
    // Some PNG decoders expose only the first APNG frame; reject the animation marker explicitly.
    for (let offset = 8; offset + 12 <= input.length;) {
      const length = input.readUInt32BE(offset);
      if (length > input.length - offset - 12) throw new Error("Invalid PNG chunk length");
      if (input.toString("ascii", offset + 4, offset + 8) === "acTL")
        throw new Error("Animated or multi-frame images are not supported");
      offset += length + 12;
    }
  }
  const source = sharp(input, { limitInputPixels: limits.maxDecodeArea, limitInputChannels: 4, failOn: "warning" });
  const metadata = await source.metadata();
  if (metadata.format !== (mimeType === "image/png" ? "png" : "jpeg"))
    throw new Error("Image MIME type does not match its contents");
  if ((metadata.pages ?? 1) !== 1) throw new Error("Animated or multi-frame images are not supported");
  if (!metadata.width || !metadata.height || metadata.width > 10000 || metadata.height > 10000)
    throw new Error("Image exceeds decode limits");
  // Fully decode even for validation: metadata alone accepts truncated pixel streams.
  return source.autoOrient().flatten({ background: "white" }).toColourspace("srgb")
    .raw().timeout({ seconds: DECODE_TIMEOUT_SECONDS }).toBuffer({ resolveWithObject: true });
}

function dimensions(width, height, limits, factor) {
  const scale = factor * Math.min(1, limits.maxDimension / width, limits.maxDimension / height,
    Math.sqrt(limits.maxArea / (width * height)));
  const resizedWidth = Math.max(1, Math.floor(width * scale));
  const resizedHeight = Math.max(1, Math.floor(height * scale));
  let canvasWidth = Math.max(limits.minDimension, resizedWidth);
  let canvasHeight = Math.max(limits.minDimension, resizedHeight);
  if (canvasWidth * canvasHeight < limits.minArea) {
    const pad = Math.sqrt(limits.minArea / (canvasWidth * canvasHeight));
    canvasWidth = Math.min(limits.maxDimension, Math.ceil(canvasWidth * pad));
    canvasHeight = Math.min(limits.maxDimension, Math.ceil(canvasHeight * pad));
    while (canvasWidth * canvasHeight < limits.minArea && canvasWidth < limits.maxDimension) canvasWidth++;
    while (canvasWidth * canvasHeight < limits.minArea && canvasHeight < limits.maxDimension) canvasHeight++;
  }
  return { resizedWidth, resizedHeight, canvasWidth, canvasHeight };
}

async function processImage(sharp, input, mimeType, limits, operation) {
  const decoded = await decode(sharp, input, mimeType, limits);
  if (operation === "inspect") return Buffer.alloc(0);
  if (operation !== "normalize") throw new Error("Invalid image processing operation");
  const { width, height, channels } = decoded.info;
  let output, size;
  // Retain the initial geometry whenever encoding alone fits; downscaling stays bounded for legibility.
  encoding: for (const factor of limits.resizeFactors) {
    size = dimensions(width, height, limits, factor);
    for (const quality of mimeType === "image/jpeg" ? limits.jpegQualities : [undefined]) {
      const left = Math.floor((size.canvasWidth - size.resizedWidth) / 2);
      const top = Math.floor((size.canvasHeight - size.resizedHeight) / 2);
      let pipeline = sharp(decoded.data, { raw: { width, height, channels } })
        .resize(size.resizedWidth, size.resizedHeight, { fit: "fill" })
        .extend({ left, right: size.canvasWidth - size.resizedWidth - left,
          top, bottom: size.canvasHeight - size.resizedHeight - top, background: "white" });
      pipeline = mimeType === "image/jpeg" ? pipeline.jpeg({ quality, chromaSubsampling: "4:4:4" })
        : pipeline.png({ compressionLevel: limits.pngCompressionLevel, adaptiveFiltering: limits.pngAdaptiveFiltering });
      output = await pipeline.timeout({ seconds: DECODE_TIMEOUT_SECONDS }).toBuffer();
      if (output.length && output.length <= limits.maxClassifierBytes) break encoding;
    }
  }
  if (!output?.length || output.length > limits.maxClassifierBytes)
    throw new Error("Normalized image exceeds classifier bounds after bounded encoding retries");
  const verified = await sharp(output, { limitInputPixels: limits.maxArea, failOn: "warning" })
    .raw().timeout({ seconds: DECODE_TIMEOUT_SECONDS }).toBuffer({ resolveWithObject: true });
  if (verified.info.width !== size.canvasWidth || verified.info.height !== size.canvasHeight ||
      size.canvasWidth < limits.minDimension || size.canvasHeight < limits.minDimension ||
      size.canvasWidth > limits.maxDimension || size.canvasHeight > limits.maxDimension ||
      size.canvasWidth * size.canvasHeight < limits.minArea || size.canvasWidth * size.canvasHeight > limits.maxArea)
    throw new Error("Normalized image exceeds classifier bounds");
  return output;
}

async function main() {
  let sharp;
  try { ({ default: sharp } = await import("sharp")); }
  catch {
    process.stderr.write("Sharp image processor is unavailable");
    process.exitCode = 2;
    return;
  }
  // Pixel/channel caps constrain decoded buffers; they are not a hard process RSS limit.
  sharp.cache(false);
  sharp.concurrency(1);
  const { operation, mimeType, limits } = JSON.parse(process.argv[2]);
  if (operation === "inspect-batch") {
    let count = 0, total = 0;
    const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const line of lines) {
      if (++count > limits.maxBatchImages || Buffer.byteLength(line) > Math.ceil(limits.maxImageBytes / 3) * 4 + 128)
        throw new Error("Image inspection batch exceeds its limits");
      const job = JSON.parse(line);
      if (!Number.isSafeInteger(job.index) || job.index < 0 || job.index >= limits.maxBatchImages || typeof job.data !== "string")
        throw new Error("Invalid image inspection request");
      try {
        const input = Buffer.from(job.data, "base64");
        total += input.length;
        if (total > limits.maxBatchBytes) throw new Error("Image inspection batch exceeds its limits");
        await processImage(sharp, input, job.mimeType, limits, "inspect");
        process.stdout.write(JSON.stringify({ index: job.index, ok: true }) + "\n");
      } catch (error) {
        const message = (error instanceof Error ? error.message : "Image validation failed").replace(/\p{Cc}/gu, " ").slice(0, 128);
        process.stdout.write(JSON.stringify({ index: job.index, ok: false, error: message }) + "\n");
      }
    }
    return;
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    total += chunk.length;
    if (total > limits.maxImageBytes) throw new Error("Image input exceeded its byte limit");
    chunks.push(chunk);
  }
  process.stdout.write(await processImage(sharp, Buffer.concat(chunks, total), mimeType, limits, operation));
}
main().catch(error => {
  process.stderr.write(error instanceof Error ? error.message : "Image processing failed");
  process.exitCode = 1;
});
