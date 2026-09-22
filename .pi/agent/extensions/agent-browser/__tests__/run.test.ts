import { describe, expect, test } from "bun:test";
import {
  createRunAuthorizationRequest,
  parseRunAuthorization,
  parseRunCandidates,
  redactSensitiveInputs,
} from "../index";

describe("browser run", () => {
  test("builds explicit candidates for clicks, fields, choices, and toggles", () => {
    const candidates = parseRunCandidates(
      [
        '- textbox "Email" [ref=e1]',
        '- checkbox "Updates" [checked=false, ref=e2]: updates',
        '- checkbox "Terms" [checked=true, ref=e3]: terms',
        '- radio "Medium" [checked=false, ref=e6]: medium',
        '- combobox "Country" [ref=e4]',
        '- button "Submit" [ref=e5]',
      ].join("\n"),
      [{ name: "email", value: "person@example.com" }],
    );

    expect(candidates).toEqual([
      {
        id: "fill:e1:0",
        description: 'Fill "email" ("person@example.com") in "Email" at @e1.',
        command: ["fill", "@e1", "person@example.com"],
        trace: { action: "fill", ref: "@e1", label: "Email", input: "email" },
      },
      {
        id: "check:e2",
        description: 'Check "Updates" at @e2.',
        command: ["check", "@e2"],
        trace: { action: "check", ref: "@e2", label: "Updates" },
      },
      {
        id: "uncheck:e3",
        description: 'Uncheck "Terms" at @e3.',
        command: ["uncheck", "@e3"],
        trace: { action: "uncheck", ref: "@e3", label: "Terms" },
      },
      {
        id: "click:e6",
        description: 'Click "Medium" at @e6.',
        command: ["click", "@e6"],
        trace: { action: "click", ref: "@e6", label: "Medium" },
      },
      {
        id: "click:e5",
        description: 'Click "Submit" at @e5.',
        command: ["click", "@e5"],
        trace: { action: "click", ref: "@e5", label: "Submit" },
      },
    ]);
  });

  test("does not expose sensitive values in Jev descriptions or traces", () => {
    const [candidate] = parseRunCandidates('- textbox "Password" [ref=e1]', [
      { name: "password", value: "correct horse battery staple", sensitive: true },
    ]);

    expect(candidate?.description).toBe(
      'Fill the provided sensitive value named "password" in "Password" at @e1.',
    );
    expect(candidate?.description).not.toContain("correct horse");
    expect(
      redactSensitiveInputs('value="correct horse battery staple"', [
        { name: "password", value: "correct horse battery staple", sensitive: true },
      ]),
    ).toBe('value="[redacted:password]"');
    expect(candidate?.trace).toEqual({
      action: "fill",
      ref: "@e1",
      label: "Password",
      input: "password",
    });
  });

  test("builds and validates an objective-authorization judgment", () => {
    const candidate = parseRunCandidates('- button "Submit" [ref=e1]')[0];
    if (candidate === undefined) throw new Error("expected candidate");

    expect(createRunAuthorizationRequest("Submit the form", "page", candidate)).toEqual({
      state: {
        objective: "Submit the form",
        page_state: "page",
        selected_action: 'Click "Submit" at @e1.',
      },
      questions: {
        authorized: {
          type: "noul",
          instructions:
            "Is this exact action directly required to fulfill the user's stated objective and supported by the observed page state?",
          criteria: {
            true: "The objective clearly requests or necessarily entails this action, including any resulting external effect.",
            false:
              "The action exceeds the objective, uses the wrong value or control, repeats completed work, lacks page evidence, or its authorization is uncertain.",
          },
        },
      },
    });
    expect(parseRunAuthorization({ answers: { authorized: { type: "noul", noul: 0.97 } } })).toBe(
      0.97,
    );
    expect(
      parseRunAuthorization({ answers: { authorized: { type: "choice", noul: 0.97 } } }),
    ).toBeUndefined();
  });
});
