import { expect, test } from "bun:test";
import {
  addToolRoutingGuidance,
  codemodeRoutingHint,
  directRoutingHint,
  inspectProviderRequest,
} from "../request";

test("inspects Responses instructions and tool descriptions without request headers or user input", () => {
  const inspected = inspectProviderRequest({
    instructions: "Batch independent calls.",
    input: [
      { role: "developer", content: [{ type: "input_text", text: "Preserve errors." }] },
      { role: "user", content: "private user content" },
    ],
    tools: [{ type: "function", name: "read", description: "Read a file." }],
    headers: { authorization: "private credential" },
  });
  expect(inspected).toEqual({
    instructions: "Batch independent calls.\n\nPreserve errors.",
    tools: [{ name: "read", description: "Read a file." }],
  });
});

test("inspects chat-style system messages and nested function declarations", () => {
  expect(
    inspectProviderRequest({
      messages: [{ role: "system", content: "Use codemode." }],
      tools: [{ type: "function", function: { name: "codemode", description: "Execute tools." } }],
    }),
  ).toEqual({
    instructions: "Use codemode.",
    tools: [{ name: "codemode", description: "Execute tools." }],
  });
});

test("handles invalid or empty request shapes", () => {
  expect(inspectProviderRequest(null)).toEqual({ instructions: "", tools: [] });
  expect(inspectProviderRequest({ system: [{ type: "text", text: "Policy." }] })).toEqual({
    instructions: "Policy.",
    tools: [],
  });
});

test("inspects the runtime's incremental tool declarations", () => {
  expect(
    inspectProviderRequest({
      instructions: "Batch calls.",
      input: [
        {
          type: "additional_tools",
          role: "developer",
          tools: [{ type: "custom", name: "codemode", description: "Run scripts." }],
        },
      ],
    }),
  ).toEqual({
    instructions: "Batch calls.",
    tools: [{ name: "codemode", description: "Run scripts." }],
  });
});

test("adds advisory routing without changing tool schemas, names, or the original payload", () => {
  const payload = {
    instructions: "System rule.",
    input: [
      {
        type: "additional_tools",
        role: "developer",
        tools: [
          {
            type: "function",
            name: "read",
            description: "Read files.",
            parameters: { type: "object" },
          },
          {
            type: "custom",
            name: "codemode",
            description: "Run scripts.",
            format: { type: "grammar" },
          },
        ],
      },
      { role: "user", content: "Read two paths." },
    ],
  };
  const original = structuredClone(payload);
  const updated = addToolRoutingGuidance(payload);
  expect(payload).toEqual(original);
  expect(updated).toEqual({
    ...payload,
    input: [
      {
        type: "additional_tools",
        role: "developer",
        tools: [
          { ...payload.input[0]?.tools?.[0], description: `${directRoutingHint}\n\nRead files.` },
          {
            ...payload.input[0]?.tools?.[1],
            description: `${codemodeRoutingHint}\n\nRun scripts.`,
          },
        ],
      },
      payload.input[1],
    ],
  });
});

test("routing advice supports nested function schemas and preserves unknown request shapes", () => {
  expect(
    addToolRoutingGuidance({
      tools: [
        {
          type: "function",
          function: { name: "read", description: "Read." },
        },
      ],
    }),
  ).toEqual({
    tools: [
      {
        type: "function",
        function: { name: "read", description: `${directRoutingHint}\n\nRead.` },
      },
    ],
  });
  expect(addToolRoutingGuidance(null)).toBeNull();
});
