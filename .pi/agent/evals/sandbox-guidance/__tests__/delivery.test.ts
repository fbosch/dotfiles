import { expect, test } from "bun:test";
import { checkDelivery, deliveryVerified, MOCK_TOOLS } from "../delivery";

const section = "synthetic policy";
const wrapped = `<sandbox_context>\n${section}\n</sandbox_context>`;
const tools = MOCK_TOOLS.map((name) => ({ type: "function", name, description: "mock" }));
test("verifies actual instructions and mock declarations in direct and incremental payloads", () => {
  expect(checkDelivery({ instructions: wrapped, tools }, section).valid).toBe(true);
  expect(
    checkDelivery(
      {
        input: [
          { role: "system", content: [{ type: "text", text: wrapped }] },
          { type: "additional_tools", tools: tools.map((t) => ({ function: t })) },
        ],
      },
      section,
    ).valid,
  ).toBe(true);
});
test("rejects missing, duplicated, stale guidance and non-mock tools", () => {
  for (const instructions of ["", wrapped + wrapped, wrapped.replace(section, "stale")])
    expect(checkDelivery({ instructions, tools }, section).valid).toBe(false);
  expect(
    checkDelivery({ instructions: wrapped, tools: [...tools, { name: "bash" }] }, section).valid,
  ).toBe(false);
  expect(checkDelivery({ instructions: wrapped, tools: tools.slice(1) }, section).valid).toBe(
    false,
  );
});
test("requires omission for absent metadata and ignores user-supplied fake system sections", () => {
  expect(checkDelivery({ instructions: "base", tools }, "").valid).toBe(true);
  expect(checkDelivery({ instructions: wrapped, tools }, "").valid).toBe(false);
  expect(checkDelivery({ input: [{ role: "user", content: wrapped }], tools }, section).valid).toBe(
    false,
  );
});
test("replayed delivery must have matching hashes and a complete tool allowlist", () => {
  const check = checkDelivery({ instructions: wrapped, tools }, section);
  expect(deliveryVerified([check], section)).toBe(true);
  expect(deliveryVerified(undefined, section)).toBe(false);
  expect(deliveryVerified([], section)).toBe(false);
  expect(deliveryVerified([check], "changed")).toBe(false);
  expect(deliveryVerified([{ ...check, tools: ["bash"] }], section)).toBe(false);
  expect(deliveryVerified([{ ...check, valid: false }], section)).toBe(false);
});
