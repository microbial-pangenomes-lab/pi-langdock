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

- GPT-5.6 Sol
- GPT-5.6 Terra
- GPT-5.6 Luna
- GPT-5.5
- GPT-5.4
- GPT-5.4 Mini
- GPT-5.2

> `langdock-llama-3.3-70b-2` is advertised by the workspace but its backend
> currently returns HTTP 500 for every request, so it is omitted. It's left
> commented out in `src/langdock.ts` to re-enable if Langdock fixes it upstream.

`langdock-anthropic` (Anthropic-compatible):

- Claude Sonnet 5
- Claude Opus 4.8
- Claude Sonnet 4.6
- Claude Opus 4.6
- Claude Haiku 4.5

## Rate Limit Footer

The bundled `ratelimit-footer` extension shows Langdock's per-minute request and token usage (from the `x-ratelimit-*-requests` / `x-ratelimit-*-tokens` response headers) in the Pi footer whenever a Langdock model is active, alongside **cumulative session** token usage (`Σ↑input ↓output`, accumulated across turns) and context usage.

> **Credit balance:** Langdock exposes no cost/credit API — there is no endpoint or response header that reports dollars spent or credit remaining (the only usage API, Usage Export, returns token counts, is historical, and needs a `USAGE_EXPORT_API` key scope). So the footer tracks **tokens consumed**, not a dollar figure; there is no way to read a key's remaining credit programmatically.

### Checking for Model Updates

To check which models your workspace exposes upstream and compare them against this extension:

```bash
npm run check-upstream
```

This creates `upstream-models-report.md`. The script uses the API key from `LANGDOCK_API_KEY` or `~/.pi/agent/auth.json`, and queries both the OpenAI and Anthropic `/models` endpoints.

## Using with Claude Code

This repo also ships `scripts/claude-langdock.sh`, a wrapper that launches
[Claude Code](https://claude.com/claude-code) against Langdock's
Anthropic-compatible endpoint using the Claude models above. It only sets
environment variables for the process it spawns, so your normal `claude` (real
Anthropic API) is unaffected — use plain `claude` for that, and this wrapper for
Langdock.

By default the API key is read from the `LANGDOCK_API_KEY` environment variable:

```bash
export LANGDOCK_API_KEY="your-api-key"
scripts/claude-langdock.sh                     # interactive, main model = Opus 4.8
```

Any arguments after `--`, or any flags the wrapper doesn't recognize, are passed
straight through to `claude`:

```bash
scripts/claude-langdock.sh -m sonnet -p "explain this repo"   # one-shot, Sonnet 4.6
scripts/claude-langdock.sh --list-models                      # list workspace models
scripts/claude-langdock.sh -- -c --verbose                    # resume last session
```

Options:

| Flag | Description | Default |
|------|-------------|---------|
| `-m`, `--model <id\|alias>` | Main model | `claude-opus-4-8-default` |
| `-s`, `--small-model <id\|alias>` | Background/fast model | `claude-haiku-4-5-20251001` |
| `-k`, `--key <key>` | API key literal | — |
| `-f`, `--key-file <path>` | Read the API key from a file | — |
| `-r`, `--region <eu\|us>` | Langdock region | `eu` |
| `-l`, `--list-models` | List workspace models and exit | — |
| `-h`, `--help` | Show help and exit | — |

Model aliases: `opus`/`opus48`, `opus46`, `sonnet`/`sonnet46`, `haiku`/`haiku45`
expand to the full `-default` IDs. Key resolution order is
`--key` > `--key-file` > `$LANGDOCK_API_KEY` > `$LANGDOCK_KEY_FILE`.

To run it from anywhere, symlink it onto your `PATH`:

```bash
ln -s "$PWD/scripts/claude-langdock.sh" ~/.local/bin/claude-langdock
```

Two caveats apply when using Claude Code (which, unlike the Pi extension, can't
set per-model compat flags):

- **Extended thinking** is unsupported on Opus 4.8/4.6 and Sonnet 4.6 (they
  require adaptive thinking, which Claude Code can't force). Keep thinking off
  with those models, or use Haiku 4.5 when you want thinking.
- **`/v1/messages/count_tokens` returns 404** on Langdock, so Claude Code's
  context metering may warn; the chat loop itself still works.

## Implementation Notes

A few non-obvious quirks of the Langdock API that shape this extension's configuration (all verified against the live EU endpoints):

- **Region:** Only the `eu` region has models for this workspace (`us` returns an empty list, and there is no Google access). The region is the `REGION` constant in `src/langdock.ts`.
- **Anthropic base URL omits `/v1`:** The `langdock-anthropic` base URL is `https://api.langdock.com/anthropic/eu` (no trailing `/v1`), because the Anthropic SDK appends `/v1/messages` itself. Including `/v1` yields a 404. The OpenAI base URL, by contrast, keeps its `/v1`.
- **OpenAI `reasoning_effort` breaks tool calls (GPT-5.2–5.5):** The OpenAI-compatible endpoint returns HTTP 400 when `reasoning_effort` is sent alongside `tools` (it's fine without tools). These GPT models therefore set `compat.supportsReasoningEffort: false` so Pi never sends it; they still reason at their default effort. That endpoint also uses `max_completion_tokens` and rejects `stream_options` (`supportsUsageInStreaming: false`).
- **GPT-5.6 (Sol/Terra/Luna) invert that quirk:** these models *default* to a non-`none` reasoning effort server-side and then reject function tools unless `reasoning_effort: "none"` is sent explicitly (`400 Function tools with reasoning_effort are not supported … set reasoning_effort to 'none'`). Because Pi always sends tools, they must send `reasoning_effort: "none"` on every request. They therefore set `compat.supportsReasoningEffort: true` and a `thinkingLevelMap` that pins every thinking level to `"none"`. The trade-off is that these models can't reason while tools are present on `/v1/chat/completions` (that would require `/v1/responses`), which is fine for a tool-driven coding agent.
- **Newer Claude models need adaptive thinking:** Claude Sonnet 5, Opus 4.8, Opus 4.6, and Sonnet 4.6 reject the classic `thinking: { type: "enabled" }` block and require `compat.forceAdaptiveThinking: true`. Claude Haiku 4.5 works with classic thinking and does not set this flag.
- **No vLLM workarounds:** Unlike the `pi-academiccloud` extension this is derived from, Langdock proxies real hosted backends (Azure OpenAI, Vertex Claude), so no custom streaming or tool-call parsing is needed — Pi's built-in `openai-completions` and `anthropic-messages` APIs are used directly.

## License

MIT
