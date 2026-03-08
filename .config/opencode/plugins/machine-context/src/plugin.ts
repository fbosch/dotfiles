import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import {
  collectDynamicMetadata,
  collectStaticMetadata,
  formatMachineContext,
  marker,
} from "./metadata";

const STARTUP_TIMING_ENABLED = process.env.OPENCODE_STARTUP_TIMING === "1";

function logStartupTiming(scope: string, start: number) {
  if (STARTUP_TIMING_ENABLED === false) {
    return;
  }

  const elapsed = (performance.now() - start).toFixed(1);
  process.stderr.write(`[opencode startup] ${scope}: ${elapsed}ms\n`);
}

type Part = {
  type?: string;
  id?: string;
  text?: string;
};

type Message = {
  info?: {
    role?: string;
  };
  parts: Part[];
};

type TransformOutput = {
  messages?: Message[];
};

class MachineContextService {
  staticMetadata = collectStaticMetadata();

  async transform(_input: Record<string, never>, output: TransformOutput) {
    try {
      const messages = output.messages;
      if (!messages?.length) return;

      let lastUser: Message | undefined;
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.info?.role === "user") {
          lastUser = message;
          break;
        }
      }

      if (!lastUser) return;

      if (
        lastUser.parts.some(
          (part) =>
            part.type === "text" &&
            typeof part.text === "string" &&
            part.text.includes(marker),
        )
      ) {
        return;
      }

      const dynamicMetadata = collectDynamicMetadata();
      const text = formatMachineContext(this.staticMetadata, dynamicMetadata);

      lastUser.parts.unshift({
        type: "text",
        id: randomUUID(),
        text,
      });
    } catch {
      return;
    }
  }
}

export const MachineContextPlugin: Plugin = async (_input: PluginInput) => {
  const start = performance.now();
  const service = new MachineContextService();

  logStartupTiming("machine-context.total", start);
  return {
    "experimental.chat.messages.transform": service.transform.bind(service),
  };
};
