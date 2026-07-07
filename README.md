# Pi Langdock Extension

A [Pi](https://github.com/earendil-works/pi/tree/main/packages/coding-agent) extension that provides access to AI models through [Langdock](https://langdock.com), the enterprise AI gateway.

## Installation

### Manual installation

1. Clone this repository:
```bash
git clone https://github.com/microbial-pangenomes-lab/pi-langdock.git
```

2. Install dependencies and build:
```bash
cd pi-langdock
npm install
npm run build
```

3. Copy the built extensions to your Pi extensions directory:
```bash
cp dist/langdock.js dist/ratelimit-footer.js ~/.pi/agent/extensions/
```

## Configuration

Set your Langdock API key as an environment variable:

```bash
export LANGDOCK_API_KEY="your-api-key"
```

Or add it to your shell configuration file (`.bashrc`, `.zshrc`, etc.). Both providers below share this single key.

## Providers

This extension registers two providers, both talking to Langdock's **EU** region:

- **`langdock`** — OpenAI-compatible endpoint (`https://api.langdock.com/openai/eu/v1`) for the GPT and Llama models.
- **`langdock-anthropic`** — Anthropic-compatible endpoint (`https://api.langdock.com/anthropic/eu/v1`) for the Claude models.

Because Langdock proxies real hosted backends (Azure OpenAI, Vertex Claude), the extension uses Pi's built-in `openai-completions` and `anthropic-messages` APIs directly — no custom streaming or tool-call handling is needed.

> The region is set via the `REGION` constant in `src/langdock.ts` (`eu` by default). Which models are actually available depends on your Langdock workspace.

## Available Models

`langdock` (OpenAI-compatible):

- GPT-5.5
- GPT-5.4
- GPT-5.4 Mini
- GPT-5.2

> `langdock-llama-3.3-70b-2` is advertised by the workspace but its backend
> currently returns HTTP 500 for every request, so it is omitted. It's left
> commented out in `src/langdock.ts` to re-enable if Langdock fixes it upstream.

`langdock-anthropic` (Anthropic-compatible):

- Claude Opus 4.8
- Claude Sonnet 4.6
- Claude Opus 4.6
- Claude Haiku 4.5

## Rate Limit Footer

The bundled `ratelimit-footer` extension shows Langdock's per-minute request and token usage (from the `x-ratelimit-*-requests` / `x-ratelimit-*-tokens` response headers) in the Pi footer whenever a Langdock model is active, alongside input/output token counts and context usage.

### Checking for Model Updates

To check which models your workspace exposes upstream and compare them against this extension:

```bash
npm run check-upstream
```

This creates `upstream-models-report.md`. The script uses the API key from `LANGDOCK_API_KEY` or `~/.pi/agent/auth.json`, and queries both the OpenAI and Anthropic `/models` endpoints.

## Implementation Notes

A few non-obvious quirks of the Langdock API that shape this extension's configuration (all verified against the live EU endpoints):

- **Region:** Only the `eu` region has models for this workspace (`us` returns an empty list, and there is no Google access). The region is the `REGION` constant in `src/langdock.ts`.
- **Anthropic base URL omits `/v1`:** The `langdock-anthropic` base URL is `https://api.langdock.com/anthropic/eu` (no trailing `/v1`), because the Anthropic SDK appends `/v1/messages` itself. Including `/v1` yields a 404. The OpenAI base URL, by contrast, keeps its `/v1`.
- **OpenAI `reasoning_effort` breaks tool calls:** The OpenAI-compatible endpoint returns HTTP 400 when `reasoning_effort` is sent alongside `tools` (it's fine without tools). The GPT models therefore set `compat.supportsReasoningEffort: false` so Pi never sends it; they still reason at their default effort. That endpoint also uses `max_completion_tokens` and rejects `stream_options` (`supportsUsageInStreaming: false`).
- **Newer Claude models need adaptive thinking:** Claude Opus 4.8, Opus 4.6, and Sonnet 4.6 reject the classic `thinking: { type: "enabled" }` block and require `compat.forceAdaptiveThinking: true`. Claude Haiku 4.5 works with classic thinking and does not set this flag.
- **No vLLM workarounds:** Unlike the `pi-academiccloud` extension this is derived from, Langdock proxies real hosted backends (Azure OpenAI, Vertex Claude), so no custom streaming or tool-call parsing is needed — Pi's built-in `openai-completions` and `anthropic-messages` APIs are used directly.

## License

MIT
