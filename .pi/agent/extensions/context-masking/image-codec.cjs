// Plain CommonJS keeps the decoder independent of Pi's TypeScript/Jiti loader.
async function main() {
  let sharp;
  try {
    ({ default: sharp } = await import("sharp"));
  } catch {
    process.stderr.write("Sharp image processor is unavailable");
    process.exitCode = 2;
    return;
  }
  // Pixel/channel caps constrain decoded buffers; they are not a hard process RSS limit.
  sharp.cache(false);
  sharp.concurrency(1);
  const { operation, mimeType, limits } = JSON.parse(process.argv[2]);
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    total += chunk.length;
    if (total > limits.maxImageBytes) throw new Error("Image input exceeded its byte limit");
    chunks.push(chunk);
  }
  const input = Buffer.concat(chunks, total);
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
  const source = sharp(input, {
    limitInputPixels: limits.maxDecodeArea,
    limitInputChannels: 4,
    failOn: "warning",
  });
  const metadata = await source.metadata();
  if (metadata.format !== (mimeType === "image/png" ? "png" : "jpeg"))
    throw new Error("Image MIME type does not match its contents");
  if ((metadata.pages ?? 1) !== 1) throw new Error("Animated or multi-frame images are not supported");
  if (!metadata.width || !metadata.height || metadata.width > 10000 || metadata.height > 10000)
    throw new Error("Image exceeds decode limits");
  // Fully decode even for validation: metadata alone accepts truncated pixel streams.
  const decoded = await source.autoOrient().flatten({ background: "white" }).toColourspace("srgb")
    .raw().timeout({ seconds: 12 }).toBuffer({ resolveWithObject: true });
  if (operation === "inspect") return;
  if (operation !== "normalize") throw new Error("Invalid image processing operation");
  const { width, height, channels } = decoded.info;
  const scale = Math.min(1, limits.maxDimension / width, limits.maxDimension / height,
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
  const left = Math.floor((canvasWidth - resizedWidth) / 2);
  const top = Math.floor((canvasHeight - resizedHeight) / 2);
  let pipeline = sharp(decoded.data, { raw: { width, height, channels } })
    .resize(resizedWidth, resizedHeight, { fit: "fill" })
    .extend({ left, right: canvasWidth - resizedWidth - left,
      top, bottom: canvasHeight - resizedHeight - top, background: "white" });
  pipeline = mimeType === "image/jpeg"
    ? pipeline.jpeg({ quality: 88, chromaSubsampling: "4:4:4" }) : pipeline.png();
  const output = await pipeline.timeout({ seconds: 12 }).toBuffer();
  if (!output.length || output.length > limits.maxClassifierBytes)
    throw new Error("Normalized image exceeds classifier bounds");
  const verified = await sharp(output, { limitInputPixels: limits.maxArea, failOn: "warning" })
    .raw().timeout({ seconds: 12 }).toBuffer({ resolveWithObject: true });
  if (verified.info.width !== canvasWidth || verified.info.height !== canvasHeight ||
      canvasWidth < limits.minDimension || canvasHeight < limits.minDimension ||
      canvasWidth > limits.maxDimension || canvasHeight > limits.maxDimension ||
      canvasWidth * canvasHeight < limits.minArea || canvasWidth * canvasHeight > limits.maxArea)
    throw new Error("Normalized image exceeds classifier bounds");
  process.stdout.write(output);
}
main().catch(error => {
  process.stderr.write(error instanceof Error ? error.message : "Image processing failed");
  process.exitCode = 1;
});
