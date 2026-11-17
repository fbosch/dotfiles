import { expect, test } from "bun:test";
import sharp from "sharp";
import { diverseStages } from "../context-classifier-diverse-history";

test("seeded panels preserve readable code pixels, tile colors, and revision placement", async () => {
  const stages = await diverseStages("sharp-panel-fixture");
  const old = stages[0]?.images[0];
  const current = stages[2]?.images[0];
  const color = stages[2]?.probes.find(probe => probe.id === "tile")?.expected;
  const colors: Record<string, readonly number[]> = { blue: [0, 0, 255], green: [0, 128, 0], orange: [255, 165, 0] };
  if (!old || !current || !color || !colors[color]) throw Error("Missing seeded image evidence");
  expect(stages[1]?.images).toEqual([]);
  const labels: Buffer[] = [];
  for (const [image, expectedColor] of [[old, [255, 0, 0]], [current, colors[color]]] as const) {
    const input = Buffer.from(image.data, "base64");
    expect(await sharp(input).metadata()).toMatchObject({ format: "png", width: 640, height: 320 });
    const tile = await sharp(input).extract({ left: 500, top: 250, width: 1, height: 1 }).raw().toBuffer();
    expect([...tile]).toEqual([...expectedColor]);
    const background = await sharp(input).extract({ left: 12, top: 12, width: 1, height: 1 }).raw().toBuffer();
    expect([...background]).toEqual([255, 255, 255]);
    const label = await sharp(input).extract({ left: 24, top: 48, width: 432, height: 42 }).raw().toBuffer();
    expect(label.filter(value => value === 0).length).toBeGreaterThan(1_500);
    labels.push(label);
  }
  expect(labels[0]).not.toEqual(labels[1]);
  const repeat = await diverseStages("sharp-panel-fixture");
  expect(repeat.map(stage => stage.images)).toEqual(stages.map(stage => stage.images));
});

test("different seeds change the printed panel code without exposing it in captions", async () => {
  const [a, b] = await Promise.all([diverseStages("panel-seed-a"), diverseStages("panel-seed-b")]);
  const currentA = a[2], currentB = b[2];
  if (!currentA?.images[0] || !currentB?.images[0]) throw Error("Missing current panels");
  const codeA = currentA.probes.find(probe => probe.id === "panel")?.expected;
  const codeB = currentB.probes.find(probe => probe.id === "panel")?.expected;
  if (!codeA || !codeB) throw Error("Missing panel answers");
  expect(codeA).not.toBe(codeB);
  expect(currentA.goal + currentA.images[0].label).not.toContain(codeA);
  expect(currentB.goal + currentB.images[0].label).not.toContain(codeB);
  const labels = await Promise.all([currentA, currentB].map(stage =>
    sharp(Buffer.from(stage.images[0]?.data ?? "", "base64"))
      .extract({ left: 24, top: 48, width: 432, height: 42 }).raw().toBuffer()));
  expect(labels[0]).not.toEqual(labels[1]);
});
