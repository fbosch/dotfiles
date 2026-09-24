import { describe, expect, test } from "bun:test";
import { OPENROUTER_GATEWAY_ENDPOINT, VERCEL_GATEWAY_ENDPOINT } from "../../../lib/jev-gateway";
import { askJevQuestion, normalizeQuestionInput, normalizeQuestionResponse } from "../index";

const request = {
  state: { ticket: "Payouts have been failing for 3 days" },
  questions: {
    urgent: { type: "noul", instructions: "Is this urgent?" },
    team: {
      type: "choice",
      instructions: "Which team?",
      criteria: { billing: "Payments", support: "Other" },
    },
    frustration: {
      type: "score",
      instructions: "How frustrated?",
      criteria: ["Calm", "Frustrated", "Angry"],
    },
  },
};
const response = {
  answers: {
    urgent: { type: "noul", noul: 0.9 },
    team: {
      type: "choice",
      choice: "billing",
      probabilities: { billing: 0.8, support: 0.2 },
      confidence: 0.8,
    },
    frustration: {
      type: "score",
      score: 1.2,
      probabilities: { "0": 0.1, "1": 0.6, "2": 0.3 },
      legend: { "0": "Calm", "1": "Frustrated", "2": "Angry" },
      confidence: 0.6,
    },
  },
};
const auth = { getProviderAuth: async () => ({ auth: { apiKey: "test-key" } }) };

describe("typesafe_question", () => {
  test("sends typed questions through the configured gateway and returns validated answers", async () => {
    let calledUrl = "";
    let sent: unknown;
    const answers = await askJevQuestion(request, auth, undefined, async (url, init) => {
      calledUrl = String(url);
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(response), { status: 200 });
    });
    expect(calledUrl).toBe(VERCEL_GATEWAY_ENDPOINT);
    expect(sent).toMatchObject({
      state: request.state,
      questions: request.questions,
      model: "typesafe-ai/jev",
    });
    expect(answers).toEqual(response.answers);
  });

  test("uses the existing OpenRouter fallback when Vercel fails", async () => {
    const urls: string[] = [];
    const answers = await askJevQuestion(request, auth, undefined, async (url) => {
      urls.push(String(url));
      return new Response(JSON.stringify(response), { status: urls.length === 1 ? 503 : 200 });
    });
    expect(urls).toEqual([VERCEL_GATEWAY_ENDPOINT, OPENROUTER_GATEWAY_ENDPOINT]);
    expect(answers).toEqual(response.answers);
  });

  test("rejects invalid or oversized inputs before sending data", async () => {
    let calls = 0;
    const fetch = async () => {
      calls++;
      return new Response("{}");
    };
    for (const invalid of [
      { ...request, state: null },
      { ...request, state: "x".repeat(65_000) },
      { ...request, questions: {} },
      { ...request, questions: { "bad key": request.questions.urgent } },
      {
        ...request,
        questions: { team: { type: "choice", instructions: "Pick", criteria: { one: "One" } } },
      },
    ]) {
      await expect(askJevQuestion(invalid, auth, undefined, fetch)).rejects.toThrow();
    }
    expect(calls).toBe(0);
  });

  test("rejects incomplete and inconsistent responses without exposing raw gateway content", () => {
    const input = normalizeQuestionInput(request);
    for (const answers of [
      { ...response.answers, urgent: { type: "noul", noul: 1.1 } },
      { ...response.answers, team: { ...response.answers.team, choice: "support" } },
      {
        ...response.answers,
        team: { ...response.answers.team, probabilities: { billing: 0.4, support: 0.4 } },
      },
      {
        ...response.answers,
        frustration: {
          ...response.answers.frustration,
          legend: { "0": "Wrong", "1": "Frustrated", "2": "Angry" },
        },
      },
      { ...response.answers, frustration: { ...response.answers.frustration, score: 2 } },
      { urgent: response.answers.urgent },
    ]) {
      expect(() => normalizeQuestionResponse({ answers, secret: "do not expose" }, input)).toThrow(
        /Jev/,
      );
    }
  });

  test("reports sanitized gateway failures and does not fetch after cancellation", async () => {
    let calls = 0;
    const controller = new AbortController();
    controller.abort();
    await expect(
      askJevQuestion(request, auth, controller.signal, async () => {
        calls++;
        return new Response("{}");
      }),
    ).rejects.toThrow(/caller-cancellation/);
    expect(calls).toBe(0);
  });
});
