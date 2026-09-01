import { expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import herdrPromptState from "../herdr-permission-state";

type ExtensionHandler = (event: { title?: string }) => void;
type EventHandler = (data: unknown) => void;
type HerdrBlockedEvent = { active: boolean; label?: string };

function createPiHarness(): {
  pi: ExtensionAPI;
  extensionHandlers: Record<string, ExtensionHandler>;
  blockedEvents: HerdrBlockedEvent[];
} {
  const extensionHandlers: Record<string, ExtensionHandler> = {};
  const eventHandlers = new Map<string, EventHandler[]>();
  const blockedEvents: HerdrBlockedEvent[] = [];
  const events = {
    on(channel: string, handler: EventHandler) {
      const channelHandlers = eventHandlers.get(channel) ?? [];
      channelHandlers.push(handler);
      eventHandlers.set(channel, channelHandlers);
      return () => {
        const index = channelHandlers.indexOf(handler);
        if (index >= 0) channelHandlers.splice(index, 1);
      };
    },
    emit(channel: string, data: unknown) {
      if (channel === "herdr:blocked") {
        blockedEvents.push(data as HerdrBlockedEvent);
      }
      for (const handler of eventHandlers.get(channel) ?? []) handler(data);
    },
  };
  const pi = {
    events,
    on(event: string, handler: ExtensionHandler) {
      extensionHandlers[event] = handler;
    },
  } as unknown as ExtensionAPI;

  return { pi, extensionHandlers, blockedEvents };
}

test("reports ask_user_question UI prompts to Herdr", () => {
  const { pi, extensionHandlers, blockedEvents } = createPiHarness();
  herdrPromptState(pi);

  extensionHandlers.ui_prompt_start?.({
    title: "Which environment?\u0000\nChoose one",
  });
  extensionHandlers.ui_prompt_end?.({});

  expect(blockedEvents).toEqual([
    {
      active: true,
      label: "Waiting for user: Which environment? Choose one",
    },
    { active: false },
  ]);
});

test("reports custom permission prompts without a title", () => {
  const { pi, extensionHandlers, blockedEvents } = createPiHarness();
  herdrPromptState(pi);

  extensionHandlers.ui_prompt_start?.({});
  extensionHandlers.ui_prompt_end?.({});

  expect(blockedEvents).toEqual([
    { active: true, label: "Waiting for user input" },
    { active: false },
  ]);
});

test("ignores duplicate prompt lifecycle events", () => {
  const { pi, extensionHandlers, blockedEvents } = createPiHarness();
  herdrPromptState(pi);

  extensionHandlers.ui_prompt_end?.({});
  extensionHandlers.ui_prompt_start?.({ title: "Question" });
  extensionHandlers.ui_prompt_start?.({ title: "Duplicate" });
  extensionHandlers.ui_prompt_end?.({});
  extensionHandlers.ui_prompt_end?.({});

  expect(blockedEvents.map(({ active }) => active)).toEqual([true, false]);
});
