import { expect, test } from "bun:test";
import { Type } from "typebox";
import { isHashlinePluginLoaded } from "../hashline-refresh";

test("detects the hashline package from the read tool source", () => {
  expect(
    isHashlinePluginLoaded({
      getAllTools: () => [
        {
          name: "read",
          description: "",
          parameters: Type.Object({}),
          promptGuidelines: [],
          sourceInfo: {
            source: "package",
            path: "/agent/npm/node_modules/pi-hashline-edit-pro/index.ts",
            scope: "user",
            origin: "package",
          },
        },
      ],
    }),
  ).toBe(true);
});

test("does not detect the built-in read tool as hashline", () => {
  expect(
    isHashlinePluginLoaded({
      getAllTools: () => [
        {
          description: "",
          parameters: Type.Object({}),
          promptGuidelines: [],
          name: "read",
          sourceInfo: {
            source: "builtin",
            path: "<builtin:read>",
            scope: "temporary",
            origin: "top-level",
          },
        },
      ],
    }),
  ).toBe(false);
});
