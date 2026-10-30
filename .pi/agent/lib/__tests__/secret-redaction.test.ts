import { describe, expect, test } from "bun:test";
import { redactSecretValues } from "../secret-redaction";

const random = ["A7fK9mP2qR5t", "V8xY3bC6dE1g", "H4jL0nS2wZ8u", "Q"].join("");
const token = `ghp_${random.slice(0, 36)}`;

describe("secret redaction", () => {
  test("preserves clean data, structural IDs, and Danish letters", () => {
    const input = {
      text: "æble, ø og å",
      nested: [true, null, 42, "src/config.ts"],
      questions: { decision: { criteria: { yes: "Use it", no: "Skip" } } },
    };
    expect(redactSecretValues(input)).toBe(input);
  });

  test("redacts nested values without mutating caller data", () => {
    const input = {
      token: "short-value",
      nested: [{ text: `Inspect ${token} twice: ${token}`, count: 3 }],
      questions: { decision: { criteria: { yes: `Use ${token}`, no: "Skip" } } },
    };
    const before = JSON.stringify(input);
    const output = redactSecretValues(input);
    expect(output.token).toBe("[REDACTED]");
    expect(output.nested).toEqual([{ text: "Inspect [REDACTED] twice: [REDACTED]", count: 3 }]);
    expect(output.questions.decision.criteria).toEqual({ yes: "Use [REDACTED]", no: "Skip" });
    expect(JSON.stringify(input)).toBe(before);
    expect(JSON.stringify(output)).not.toContain(token);
  });

  test.each([
    { name: "GitHub", value: token },
    { name: "GitHub fine-grained", value: `github_pat_${random}` },
    { name: "Google", value: `AIzaSy${random.slice(0, 33)}` },
    { name: "npm", value: `npm_${random.slice(0, 36)}` },
    { name: "OpenAI", value: `sk-${random.slice(0, 32)}` },
    { name: "Anthropic", value: `sk-ant-api03-${random}` },
    { name: "AWS access key", value: `AKIA${"1234567890ABCDEF"}` },
    { name: "AWS session access key", value: `ASIA${"1234567890ABCDEF"}` },
    { name: "Slack", value: `xoxb-123456789012-123456789012-${random.slice(0, 24)}` },
    { name: "Stripe live", value: `sk_live_${random.slice(0, 24)}` },
    { name: "Stripe restricted", value: `rk_test_${random.slice(0, 24)}` },
    { name: "SendGrid", value: `SG.${random.slice(0, 22)}.${random}${random.slice(0, 3)}` },
    {
      name: "JWT",
      value: `eyJ${random.slice(0, 20)}.eyJ${random.slice(0, 20)}.${random.slice(0, 20)}`,
    },
  ])("redacts $name credentials embedded in prose", ({ value }) => {
    expect(redactSecretValues({ text: `Use ${value}, then continue.` })).toEqual({
      text: "Use [REDACTED], then continue.",
    });
  });

  test.each([
    "password",
    "client_secret",
    "api_key",
    "access_token",
    "refreshToken",
    "authorization",
    "private_key",
    "aws_secret_access_key",
    "AWS_ACCESS_KEY_ID",
  ])("redacts the whole value for a %s field or assignment", (field) => {
    expect(redactSecretValues({ [field]: "synthetic-value" })).toEqual({ [field]: "[REDACTED]" });
    expect(redactSecretValues(`Inspect ${field}=synthetic-value; then continue.`)).toBe(
      `Inspect ${field}=[REDACTED]; then continue.`,
    );
  });

  test.each([
    { value: 'password="simple value"', expected: "password=[REDACTED]" },
    { value: 'password="synthetic\\"quoted value"', expected: "password=[REDACTED]" },
    { value: "password='synthetic\\'quoted value'", expected: "password=[REDACTED]" },
    { value: '"password":"synthetic-value"', expected: '"password":[REDACTED]' },
  ])("redacts quoted, escaped, and JSON assignments", ({ value, expected }) => {
    expect(redactSecretValues<string>(value)).toBe(expected);
  });

  test("redacts bearer credentials and URL passwords without losing surrounding context", () => {
    expect(
      redactSecretValues({
        text: `Inspect ${token}; client_secret=example-secret; Bearer opaque-value`,
        url: "postgres://user:example-password@example.test/db",
      }),
    ).toEqual({
      text: "Inspect [REDACTED]; client_secret=[REDACTED]; Bearer [REDACTED]",
      url: "postgres://user:[REDACTED]@example.test/db",
    });
  });

  test.each([
    "-----BEGIN PRIVATE KEY-----\nexample material\n-----END PRIVATE KEY-----",
    "-----BEGIN RSA PRIVATE KEY-----\nexample material\n-----END RSA PRIVATE KEY-----",
    "-----BEGIN OPENSSH PRIVATE KEY-----\nexample material",
  ])("redacts private-key blocks", (value) => {
    expect(redactSecretValues<string>(value)).toBe("[REDACTED]");
  });

  test("redacts sensitive arrays and preserves safe siblings", () => {
    const safe = { path: "src/config.ts" };
    const output = redactSecretValues({ api_key: ["example-one", "example-two"], safe });
    expect(output.api_key).toEqual(["[REDACTED]", "[REDACTED]"]);
    expect(output.safe).toBe(safe);
  });

  test("conversation allowlist directives do not exempt credentials", () => {
    expect(redactSecretValues(`${token} # pragma: allowlist secret`)).toBe(
      "[REDACTED] # pragma: allowlist secret",
    );
  });

  test("redaction is idempotent", () => {
    const output = redactSecretValues({ text: `password="example"; token=${token}` });
    expect(redactSecretValues(output)).toBe(output);
  });

  test.each([
    "Inspect the configuration and summarize the change.",
    "The password and API key are configured locally.",
    "src/tokenizer.ts",
    "https://example.test/path",
    "api_key",
    "sk_live_documentation",
  ])("preserves ordinary text: %s", (value) => {
    expect(redactSecretValues<string>(value)).toBe(value);
  });

  test("redacts credentials in a bounded large payload", () => {
    const text = `${"safe ".repeat(6000)}${token}${" safe".repeat(6000)}`;
    expect(redactSecretValues({ text }).text).toBe(
      `${"safe ".repeat(6000)}[REDACTED]${" safe".repeat(6000)}`,
    );
  });
});
