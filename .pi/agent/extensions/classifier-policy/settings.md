# Classifier settings

To disable classifier requests everywhere, set `classifier.enabled` to `false` in `~/.pi/agent/settings.json`:

```json
{
  "classifier": {
    "enabled": false
  }
}
```

Use the same setting in `<project>/.pi/settings.json` to opt out for a trusted project. Project `true` cannot override global `false`. An omitted switch defaults to `true`; malformed settings prevent requests.

Run `/reload` once after installing this extension. The policy re-reads settings before each request, so later switch changes need no reload. It covers the shared requester and native `modelRegistry.classify()`, including codemode `models.classify()`. Existing integrations retain their fallback or error behavior when classification is disabled. Ordinary chat-model calls are unaffected.

## Input-aware routing

Text-only requests use `classifier.providers`; requests containing images use `classifier.imageProviders`. Both default to Jev 1.14 through OpenRouter, with Luna Decisions as the fallback:

```json
{
  "classifier": {
    "providers": [
      { "provider": "openrouter", "model": "typesafe/jev-1.14" },
      { "provider": "openrouter", "model": "openai/gpt-6-luna-decisions" }
    ],
    "imageProviders": [
      { "provider": "openrouter", "model": "typesafe/jev-1.14" },
      { "provider": "openrouter", "model": "openai/gpt-6-luna-decisions" }
    ]
  }
}
```

Each list accepts up to eight registered classifier models in fallback order. The requester checks the current registry's input capabilities before calling a model. Image requests never fall back to text-only models or omit an image to obtain an answer. Missing models or credentials produce an unavailable-classifier error. Provider cooldowns apply across both routes.

For a judgment about an image attached to the latest user message, set `includeAttachedImages: true` on `typesafe_question`. Attachments are not included automatically in unrelated text-only judgments. Earlier turns' images are not reused when the latest user message has no images.

Programmatic callers can instead pass `images` alongside `state` and `questions`:

```ts
{
  state: { task: "Check screenshot" },
  images: [{ type: "image", data: "<base64>", mimeType: "image/png" }],
  questions: {
    readable: {
      type: "bool",
      instructions: "Is the screenshot readable?",
      criteria: { true: "Readable", false: "Not readable" },
    },
  },
}
```

Image input is bounded to four PNG, JPEG, or WebP blocks, each at most 5 MiB base64-encoded. State and questions retain their separate 64 KB limit. Attached and explicit images share the same bounds. All supplied state and images are sent to the selected provider; do not include secrets or sensitive data.

Jev's image support is experimental and has stricter [format and dimension limits](https://docs.typesafe.ai/images#limits). It accepts PNG and JPEG, not WebP. The requester passes images rejected by Jev intact to Luna. Both defaults use OpenRouter, so this fallback does not bypass an OpenRouter outage or provider cooldown.

Pi's current System One adapter rejects image input. The OpenRouter bridge converts images to the [documented multimodal Decisions format](https://openrouter.ai/docs/guides/community/multimodal-decisions) while retaining native authentication, question mapping, answer parsing, and usage accounting. Unexpected transport or payload shapes fail before sending. Remove the bridge when Pi supports OpenRouter images natively.

The opt-in installed-SDK test takes `PI_CLASSIFIER_RUNTIME_MODULE`, the absolute path to the installed Pi coding-agent SDK's `dist/index.js`. It probes both native and tool-facing paths with mocked HTTP, without launching a nested Pi sandbox or sending a billed request.
