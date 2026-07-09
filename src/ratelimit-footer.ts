/**
 * Langdock Rate Limit Footer Extension
 *
 * Shows current rate limit usage for the Langdock API in the footer.
 * Langdock exposes per-minute request and token buckets via the standard
 * OpenAI-style x-ratelimit-*-requests / x-ratelimit-*-tokens response headers.
 * These are displayed alongside cumulative session token usage (Σ↑input
 * ↓output), which accumulates across turns so you can gauge how much you've
 * consumed. Note: Langdock exposes no cost/credit-balance API, so this is a
 * token tally, not a dollar figure or a remaining-credit readout.
 *
 * This extension is automatically loaded when the package is installed.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

interface RateLimitState {
  remainingRequests: number | null;
  remainingTokensBucket: number | null;
  limitRequests: number;
  limitTokensBucket: number;
  lastUpdate: number;
  inputTokens: number;
  outputTokens: number;
}

export default function (pi: ExtensionAPI) {
  const state: RateLimitState = {
    remainingRequests: null,
    remainingTokensBucket: null,
    limitRequests: 500,
    limitTokensBucket: 60000,
    lastUpdate: 0,
    inputTokens: 0,
    outputTokens: 0,
  };

  let footerDispose: (() => void) | undefined;
  let isActive = false;
  let currentTui: any = null;

  function isLangdockModel(model: any): boolean {
    return (
      model?.provider === "langdock" ||
      model?.provider === "langdock-anthropic" ||
      (model?.baseUrl?.includes("api.langdock.com") ?? false)
    );
  }

  // Reset the per-minute rate-limit buckets (e.g. on compaction). Cumulative
  // token totals are intentionally NOT cleared here: those tokens were really
  // consumed, and the footer tracks them as session-wide usage.
  function resetRateLimit() {
    state.remainingRequests = null;
    state.remainingTokensBucket = null;
    state.lastUpdate = 0;
  }

  // Full reset, including cumulative usage (e.g. on a fresh session).
  function resetState() {
    resetRateLimit();
    state.inputTokens = 0;
    state.outputTokens = 0;
  }

  function requestFooterRender() {
    if (currentTui) {
      currentTui.requestRender();
    }
  }

  function setupRateLimitFooter(ctx: ExtensionContext) {
    ctx.ui.setFooter((tui, theme, footerData) => {
      currentTui = tui;
      const unsub = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose: () => {
          unsub();
          currentTui = undefined;
        },
        invalidate() {},
        render(width: number): string[] {
          // Compute tokens from state (tracked from API responses)
          const contextUsage = ctx.getContextUsage();
          const contextPercent = contextUsage?.percent;
          const inputTokens = state.inputTokens;
          const outputTokens = state.outputTokens;

          const branch = footerData.getGitBranch();
          const fmt = (n: number) => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`);

          // Compute context window usage percentage
          let contextPct: string | null = null;
          if (contextPercent !== null && contextPercent !== undefined) {
            const pct = Math.min(100, Math.round(contextPercent));
            contextPct = `${pct}%`;
          }

          // Build rate limit display (only show when a Langdock model is active).
          // Langdock rate limits are per-minute: requests and tokens.
          const rateLimitParts: string[] = [];

          if (isActive && state.lastUpdate > 0) {
            if (state.remainingRequests !== null && state.limitRequests) {
              const usedRequests = state.limitRequests - state.remainingRequests;
              const pctRequests = Math.round((usedRequests / state.limitRequests) * 100);
              const color = pctRequests > 80 ? "error" : pctRequests > 50 ? "warning" : "dim";
              rateLimitParts.push(theme.fg(color as any, `req:${usedRequests}/${state.limitRequests}`));
            }
            if (state.remainingTokensBucket !== null && state.limitTokensBucket) {
              const usedTokens = state.limitTokensBucket - state.remainingTokensBucket;
              const pctTokens = Math.round((usedTokens / state.limitTokensBucket) * 100);
              const color = pctTokens > 80 ? "error" : pctTokens > 50 ? "warning" : "dim";
              rateLimitParts.push(theme.fg(color as any, `tok:${fmt(usedTokens)}/${fmt(state.limitTokensBucket)}`));
            }
          }

          // Don't show cost for Langdock (company account, free to the user)
          const contextStr = contextPct ? theme.fg("dim", `[${contextPct}]`) : "";
          // Σ marks these as cumulative session totals (not just the last turn).
          const tokenStr = theme.fg("dim", `Σ↑${fmt(inputTokens)} ↓${fmt(outputTokens)}${contextStr ? " " + contextStr : ""}`);
          const rateLimitStr = rateLimitParts.length > 0 ? rateLimitParts.join(" ") : "";
          const branchStr = branch ? ` (${branch})` : "";
          const providerStr = isActive ? theme.fg("accent" as any, "(langdock)") : "";
          const modelStr = theme.fg("dim", ctx.model?.id || "no-model");

          const left = `${tokenStr}${rateLimitStr ? " | " + rateLimitStr : ""}`;
          const right = `${modelStr}${providerStr ? " " + providerStr : ""}${branchStr}`;

          const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
          return [truncateToWidth(left + pad + right, width)];
        },
      };
    });
  }

  // Track rate limits from Langdock API responses (headers only)
  pi.on("after_provider_response", async (event: any, ctx) => {
    if (!isLangdockModel(ctx.model)) {
      return;
    }

    const headers = event.headers;
    if (!headers) return;

    const remainingRequests = headers["x-ratelimit-remaining-requests"];
    const remainingTokens = headers["x-ratelimit-remaining-tokens"];
    const limitRequests = headers["x-ratelimit-limit-requests"];
    const limitTokens = headers["x-ratelimit-limit-tokens"];

    if (remainingRequests !== undefined) state.remainingRequests = parseInt(remainingRequests, 10);
    if (remainingTokens !== undefined) state.remainingTokensBucket = parseInt(remainingTokens, 10);
    if (limitRequests !== undefined) state.limitRequests = parseInt(limitRequests, 10);
    if (limitTokens !== undefined) state.limitTokensBucket = parseInt(limitTokens, 10);

    state.lastUpdate = Date.now();

    // Request footer re-render
    requestFooterRender();
  });

  // Track token usage from message_end event
  //
  // Pi providers differ in the usage shape they emit. In practice we've seen:
  // - { input, output } (Pi-normalized)
  // - { input_tokens, output_tokens } (OpenAI-style)
  // - { prompt_tokens, completion_tokens, total_tokens } (OpenAI legacy)
  // - { input_tokens, output_tokens, cache_* } (Anthropic-style)
  //
  // So we defensively normalize several common variants.
  pi.on("message_end", async (event: any, ctx) => {
    if (!isLangdockModel(ctx.model)) {
      return;
    }

    const msg = event?.message;
    const usage = msg?.usage;
    if (msg?.role !== "assistant" || !usage) return;

    const input =
      usage.input ??
      usage.input_tokens ??
      usage.prompt_tokens ??
      0;

    const output =
      usage.output ??
      usage.output_tokens ??
      usage.completion_tokens ??
      0;

    // Accumulate across turns so the footer shows cumulative session usage.
    // Note: each turn's input already includes the resent context, which is
    // exactly what Langdock bills, so summing gives true tokens consumed.
    state.inputTokens += typeof input === "number" ? input : 0;
    state.outputTokens += typeof output === "number" ? output : 0;
    requestFooterRender();
  });

  // Reset state on session start
  pi.on("session_start", async (_event: any, _ctx) => {
    resetState();
  });

  // Reset only the per-minute buckets on compaction; keep cumulative usage.
  pi.on("session_compact", async (_event: any, _ctx) => {
    resetRateLimit();
    requestFooterRender();
  });

  // Auto-enable footer when using Langdock models
  pi.on("input", async (event: any, ctx) => {
    const wasActive = isActive;
    isActive = isLangdockModel(ctx.model);

    if (isActive) {
      if (footerDispose) {
        footerDispose();
      }
      setupRateLimitFooter(ctx);
    } else if (wasActive && footerDispose) {
      // Was active but now switched away - remove footer
      footerDispose();
      footerDispose = undefined;
      ctx.ui.setFooter(undefined);
    }
  });
}
