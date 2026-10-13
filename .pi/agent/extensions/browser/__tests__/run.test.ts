import { describe, expect, test } from "bun:test";
import {
  createRunAuthorizationRequest,
  findDeterministicInputCandidate,
  parseClickCandidates,
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
        interaction: { action: "fill", target: "@e1", value: "person@example.com" },
        authorization: "choice",
        trace: { action: "fill", ref: "@e1", label: "Email", input: "email" },
      },
      {
        id: "check:e2",
        description: 'Check "Updates" at @e2.',
        interaction: { action: "check", target: "@e2" },
        authorization: "choice",
        trace: { action: "check", ref: "@e2", label: "Updates" },
      },
      {
        id: "uncheck:e3",
        description: 'Uncheck "Terms" at @e3.',
        interaction: { action: "uncheck", target: "@e3" },
        trace: { action: "uncheck", ref: "@e3", label: "Terms" },
        authorization: "choice",
      },
      {
        id: "click:e6",
        description: 'Click "Medium" at @e6.',
        interaction: { action: "click", target: "@e6" },
        authorization: "choice",
        trace: { action: "click", ref: "@e6", label: "Medium" },
      },
      {
        id: "click:e5",
        description: 'Click "Submit" at @e5.',
        interaction: { action: "click", target: "@e5" },
        authorization: "independent",
        trace: { action: "click", ref: "@e5", label: "Submit" },
      },
    ]);
  });

  test("does not expose sensitive values in Classifier descriptions or traces", () => {
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

  test("selects only one-to-one named input mappings deterministically", () => {
    const unique = parseRunCandidates(
      ['- textbox "Email" [ref=e1]', '- textbox "Name" [ref=e2]'].join("\n"),
      [
        { name: "email", value: "person@example.com" },
        { name: "name", value: "Ada" },
      ],
    );
    expect(findDeterministicInputCandidate(unique)?.id).toBe("fill:e1:0");

    const ambiguous = parseRunCandidates(
      ['- textbox "Email" [ref=e1]', '- textbox "Email address" [ref=e2]'].join("\n"),
      [{ name: "email", value: "person@example.com" }],
    );
    expect(findDeterministicInputCandidate(ambiguous)).toBeUndefined();
  });

  test("uses a native bool authorization judgment for independent clicks", () => {
    const candidate = parseRunCandidates('- button "Submit" [ref=e1]')[0];
    if (candidate === undefined) throw new Error("expected candidate");
    expect(candidate.authorization).toBe("independent");

    expect(createRunAuthorizationRequest("Submit the form", "page", candidate)).toEqual({
      state: {
        objective: "Submit the form",
        page_state: "page",
        selected_action: 'Click "Submit" at @e1.',
      },
      questions: {
        authorized: {
          type: "bool",
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
  });
  test("decodes escaped labels and preserves Danish letters across shared parsers", () => {
    const label = 'Åbn "konto" med æ, ø og å';
    const candidates = parseClickCandidates(`- button ${JSON.stringify(label)} [ref=e1]`);
    expect(candidates[0]?.label).toBe(label);
    const fields = parseRunCandidates(`- textbox ${JSON.stringify('E-mail "privat"')} [ref=e2]`, [
      { name: "email", value: "supplied" },
    ]);
    expect(fields[0]?.trace.label).toBe('E-mail "privat"');
    expect(fields[0]?.interaction).toEqual({ action: "fill", target: "@e2", value: "supplied" });
  });
  test("redacts JSON and URL encodings of supplied secrets from native snapshot context", () => {
    const secret = 'private "quoted" value æøå';
    const inputs = [{ name: "secret", value: secret, sensitive: true }];
    expect(redactSensitiveInputs(JSON.stringify({ value: secret }), inputs)).toBe(
      '{"value":"[redacted:secret]"}',
    );
    expect(
      redactSensitiveInputs(
        `URL: https://example.com/?value=${encodeURIComponent(secret)}`,
        inputs,
      ),
    ).toBe("URL: https://example.com/?value=[redacted:secret]");
    expect(redactSensitiveInputs(new URLSearchParams({ value: secret }).toString(), inputs)).toBe(
      "value=[redacted:secret]",
    );
  });
});
