import sharp from "sharp";

export function solidImage(color = "blue", width = 720, height = 131): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
}

export function syntheticImage(width: number, height: number, mimeType: "image/png" | "image/jpeg" = "image/png"): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3, 255);
  const rectangle = (left: number, top: number, right: number, bottom: number, colour: number[]) => {
    for (let y = top; y <= Math.min(bottom, height - 1); y++) {
      for (let x = left; x <= Math.min(right, width - 1); x++) {
        const offset = (y * width + x) * 3;
        raw[offset] = colour[0] ?? 0;
        raw[offset + 1] = colour[1] ?? 0;
        raw[offset + 2] = colour[2] ?? 0;
      }
    }
  };
  rectangle(10, 10, width === 720 ? 80 : 100, height === 131 ? 60 : 100, [17, 17, 17]);
  if (width === 720 && height === 131) {
    rectangle(0, 99, 719, 101, [34, 85, 170]);
    rectangle(500, 20, 550, 90, [204, 51, 51]);
  }
  const image = sharp(raw, { raw: { width, height, channels: 3 } });
  return mimeType === "image/jpeg" ? image.jpeg({ quality: 88 }).toBuffer() : image.png().toBuffer();
}

export async function imageDimensions(bytes: Buffer, _mimeType: "image/png" | "image/jpeg") {
  const { width, height } = await sharp(bytes).metadata();
  if (!width || !height) throw new Error("Invalid synthetic image dimensions");
  return { width, height };
}

export async function pixelColour(bytes: Buffer, x: number, y: number): Promise<string> {
  const { data } = await sharp(bytes).extract({ left: x, top: y, width: 1, height: 1 })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return `${data[0]},${data[1]},${data[2]}`;
}

export function noisyImage(width = 720, height = 720): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  let seed = 7;
  for (let offset = 0; offset < raw.length; offset += 3) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const value = seed & 0xff;
    raw[offset] = value;
    raw[offset + 1] = value;
    raw[offset + 2] = value;
  }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toBuffer();
}

export async function randomPng(width: number, height: number) {
  const raw = Buffer.alloc(width * height * 3);
  let seed = 17;
  for (let offset = 0; offset < raw.length; offset++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    raw[offset] = seed & 0xff;
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}
