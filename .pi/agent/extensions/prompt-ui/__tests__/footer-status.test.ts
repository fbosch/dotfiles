import { describe, expect, test } from "bun:test";
import { renderFooterStatus } from "../prompt-editor";

describe("prompt footer statuses", () => {
  test("renders the permission-system YOLO status with its icon and error color", () => {
    const theme = {
      fg: (color: string, text: string) => `${color}:${text}`,
    };

    expect(renderFooterStatus(theme, "pi-permission-system", "yolo")).toBe("error:󱚝 yolo");
  });

  test("preserves unrelated status text", () => {
    const theme = {
      fg: (color: string, text: string) => `${color}:${text}`,
    };

    expect(renderFooterStatus(theme, "other", "status")).toBe("status");
  });
});
