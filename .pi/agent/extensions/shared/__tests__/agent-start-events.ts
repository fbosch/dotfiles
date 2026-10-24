import type {
  BeforeAgentStartCustomEvent,
  BeforeAgentStartUserEvent,
} from "@earendil-works/pi-coding-agent";

function promptOptions(): BeforeAgentStartUserEvent["systemPromptOptions"] {
  return {
    cwd: "/repo",
    selectedTools: [],
    hiddenTools: [],
    toolSnippets: {},
    toolGuidelines: {},
    promptGuidelines: [],
    appendSystemPrompt: "",
    sections: {},
    contextFiles: [],
    skills: [],
  };
}

export function userStartEvent(prompt: string): BeforeAgentStartUserEvent {
  return {
    type: "before_agent_start",
    messageType: "user",
    prompt,
    systemPrompt: "",
    systemPromptOptions: promptOptions(),
  };
}

export function customStartEvent(): BeforeAgentStartCustomEvent {
  return {
    type: "before_agent_start",
    messageType: "custom",
    message: {
      role: "custom",
      customType: "worker-completion",
      content: "Background worker completed",
      display: false,
      timestamp: 0,
    },
    systemPrompt: "",
    systemPromptOptions: promptOptions(),
  };
}
