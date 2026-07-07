import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// =============================================================================
// Langdock provider extension
//
// Langdock proxies real hosted backends (Azure OpenAI, Vertex Claude) that
// speak clean OpenAI / Anthropic protocols, so we use pi's built-in
// `openai-completions` and `anthropic-messages` APIs directly — no custom
// streaming or tool-call parsing is needed.
//
// Both providers authenticate with the same key via $LANGDOCK_API_KEY.
// =============================================================================

// HZI only has access to the EU region (US returns an empty model list).
// Kept as a single const so it's easy to switch if that changes.
const REGION = "eu";

// The OpenAI-compatible endpoint uses `max_completion_tokens` (not the
// deprecated `max_tokens`) and rejects `stream_options`, so usage cannot be
// requested during streaming. It also rejects `reasoning_effort` whenever tools
// are present (a Langdock/Azure quirk), which breaks every tool-calling turn —
// so we never send it. The GPT-5 models still reason at their default effort.
const openaiCompat = {
  maxTokensField: "max_completion_tokens" as const,
  supportsUsageInStreaming: false,
  supportsReasoningEffort: false,
};

// The Claude 4.6/4.8-generation models on Langdock (Vertex) reject the classic
// `thinking: { type: "enabled" }` block and require adaptive thinking instead.
const anthropicAdaptiveCompat = {
  forceAdaptiveThinking: true,
};

const zeroCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export default function (pi: ExtensionAPI) {
  // OpenAI-compatible models (GPT-5.x + Llama 3.3)
  pi.registerProvider("langdock", {
    name: "Langdock",
    baseUrl: `https://api.langdock.com/openai/${REGION}/v1`,
    apiKey: "$LANGDOCK_API_KEY",
    api: "openai-completions",
    models: [
      {
        id: "gpt-5.5",
        name: "GPT-5.5",
        reasoning: true,
        input: ["text", "image"],
        cost: zeroCost,
        contextWindow: 272000,
        maxTokens: 16384,
        compat: openaiCompat,
      },
      {
        id: "gpt-5.4",
        name: "GPT-5.4",
        reasoning: true,
        input: ["text", "image"],
        cost: zeroCost,
        contextWindow: 272000,
        maxTokens: 16384,
        compat: openaiCompat,
      },
      {
        id: "gpt-5.4-mini",
        name: "GPT-5.4 Mini",
        reasoning: true,
        input: ["text", "image"],
        cost: zeroCost,
        contextWindow: 272000,
        maxTokens: 16384,
        compat: openaiCompat,
      },
      {
        id: "gpt-5.2",
        name: "GPT-5.2",
        reasoning: true,
        input: ["text", "image"],
        cost: zeroCost,
        contextWindow: 272000,
        maxTokens: 16384,
        compat: openaiCompat,
      },
      // `langdock-llama-3.3-70b-2` is advertised by /models but its backend
      // currently returns HTTP 500 ("Connection error.") for every request, so
      // it is omitted. Re-add it here if Langdock fixes it upstream:
      // {
      //   id: "langdock-llama-3.3-70b-2",
      //   name: "Llama 3.3 70B",
      //   reasoning: false,
      //   input: ["text"],
      //   cost: zeroCost,
      //   contextWindow: 131072,
      //   maxTokens: 8192,
      //   compat: openaiCompat,
      // },
    ],
  });

  // Anthropic-compatible models (Claude).
  // The Anthropic SDK appends `/v1/messages` to the base URL itself, so the
  // base URL must NOT include the trailing `/v1` (unlike the OpenAI one above).
  pi.registerProvider("langdock-anthropic", {
    name: "Langdock (Claude)",
    baseUrl: `https://api.langdock.com/anthropic/${REGION}`,
    apiKey: "$LANGDOCK_API_KEY",
    api: "anthropic-messages",
    models: [
      {
        id: "claude-opus-4-8-default",
        name: "Claude Opus 4.8",
        reasoning: true,
        input: ["text", "image"],
        cost: zeroCost,
        contextWindow: 200000,
        maxTokens: 32000,
        compat: anthropicAdaptiveCompat,
      },
      {
        id: "claude-sonnet-4-6-default",
        name: "Claude Sonnet 4.6",
        reasoning: true,
        input: ["text", "image"],
        cost: zeroCost,
        contextWindow: 200000,
        maxTokens: 32000,
        compat: anthropicAdaptiveCompat,
      },
      {
        id: "claude-opus-4-6-default",
        name: "Claude Opus 4.6",
        reasoning: true,
        input: ["text", "image"],
        cost: zeroCost,
        contextWindow: 200000,
        maxTokens: 32000,
        compat: anthropicAdaptiveCompat,
      },
      {
        id: "claude-haiku-4-5-20251001",
        name: "Claude Haiku 4.5",
        reasoning: true,
        input: ["text", "image"],
        cost: zeroCost,
        contextWindow: 200000,
        maxTokens: 32000,
      },
    ],
  });
}
