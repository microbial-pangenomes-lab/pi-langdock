#!/usr/bin/env node
/**
 * Script to check which models are available upstream (in Langdock)
 * and generate a markdown report comparing them with the extension's models.
 *
 * The script queries both Langdock completion endpoints (OpenAI-compatible and
 * Anthropic-compatible) and unions the results.
 *
 * The script automatically reads the API key from:
 *   1. LANGDOCK_API_KEY environment variable (highest priority)
 *   2. ~/.pi/agent/auth.json (pi's default auth file)
 *
 * Usage:
 *   npm run check-upstream
 * 
 * Or:
 *   npx tsx scripts/check-upstream-models.ts
 * 
 * Output:
 *   Creates upstream-models-report.md in the project root
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// HZI only has access to the EU region.
const REGION = "eu";
const LANGDOCK_BASE_URLS = [
  `https://api.langdock.com/openai/${REGION}/v1`,
  `https://api.langdock.com/anthropic/${REGION}/v1`,
];
const OUTPUT_FILE = path.join(__dirname, "../upstream-models-report.md");
const EXTENSION_SOURCE = path.join(__dirname, "../src/langdock.ts");

/**
 * Extract model IDs from the extension source code.
 * Parses the langdock.ts file and extracts all active (non-commented) model IDs.
 */
function extractExtensionModels(): string[] {
  if (!fs.existsSync(EXTENSION_SOURCE)) {
    console.warn(`Warning: Extension source not found at ${EXTENSION_SOURCE}`);
    return [];
  }

  const source = fs.readFileSync(EXTENSION_SOURCE, "utf-8");
  const modelIds: string[] = [];

  // Split into lines and process each line
  const lines = source.split("\n");
  for (const line of lines) {
    // Skip commented lines (both // and /* style)
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) {
      continue;
    }

    // Match model ID declarations: id: "model-id"
    const idMatch = trimmed.match(/id:\s*["']([^"']+)["']/);
    if (idMatch) {
      modelIds.push(idMatch[1]);
    }
  }

  return modelIds;
}

interface UpstreamModel {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
  [key: string]: any;
}

function getApiKey(): string | null {
  // Priority 1: Environment variable
  if (process.env.LANGDOCK_API_KEY) {
    return process.env.LANGDOCK_API_KEY;
  }

  // Priority 2: Read from pi's auth.json
  try {
    const authPath = path.join(process.env.HOME || "", ".pi", "agent", "auth.json");
    if (fs.existsSync(authPath)) {
      const authData = JSON.parse(fs.readFileSync(authPath, "utf-8"));
      // Check for langdock keys
      if (authData.langdock?.key) {
        return authData.langdock.key;
      }
      if (authData["langdock-anthropic"]?.key) {
        return authData["langdock-anthropic"].key;
      }
    }
  } catch (error) {
    console.warn("Warning: Could not read pi auth.json:", error);
  }

  return null;
}

async function fetchModelsFrom(baseUrl: string, apiKey: string | null): Promise<UpstreamModel[]> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    // Langdock accepts a Bearer token on both the OpenAI and Anthropic endpoints.
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${baseUrl}/models`, {
    method: "GET",
    headers,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();

  if (data.data && Array.isArray(data.data)) {
    return data.data;
  } else if (Array.isArray(data)) {
    return data;
  } else {
    console.error(`Unexpected response format from ${baseUrl}:`, JSON.stringify(data, null, 2));
    return [];
  }
}

async function fetchUpstreamModels(): Promise<UpstreamModel[]> {
  const apiKey = getApiKey();

  if (!apiKey) {
    console.warn("Warning: No API key found.");
    console.warn("Please set LANGDOCK_API_KEY or ensure ~/.pi/agent/auth.json contains the key.");
  }

  // Query every Langdock completion endpoint and union the results by model id.
  const byId = new Map<string, UpstreamModel>();
  for (const baseUrl of LANGDOCK_BASE_URLS) {
    try {
      const models = await fetchModelsFrom(baseUrl, apiKey);
      for (const model of models) {
        if (!byId.has(model.id)) byId.set(model.id, model);
      }
    } catch (error) {
      console.error(`Error fetching upstream models from ${baseUrl}:`, error);
      throw error;
    }
  }

  return [...byId.values()];
}

function generateMarkdownReport(
  upstreamModels: UpstreamModel[],
  extensionModels: string[]
): string {
  const upstreamIds = new Set(upstreamModels.map((m) => m.id));
  const extensionSet = new Set(extensionModels);

  const modelsOnlyInUpstream = upstreamModels.filter(
    (m) => !extensionSet.has(m.id)
  );
  const modelsOnlyInExtension = extensionModels.filter(
    (id) => !upstreamIds.has(id)
  );
  const modelsInBoth = extensionModels.filter((id) => upstreamIds.has(id));

  const reportDate = new Date().toISOString().split("T")[0];

  let markdown = `# Langdock Upstream Models Report

**Generated:** ${reportDate}
**Upstream URLs:** ${LANGDOCK_BASE_URLS.join(", ")}

## Summary

- **Models in upstream:** ${upstreamModels.length}
- **Models in extension:** ${extensionModels.length}
- **Models only in upstream (missing from extension):** ${modelsOnlyInUpstream.length}
- **Models only in extension (not found upstream):** ${modelsOnlyInExtension.length}
- **Models in both:** ${modelsInBoth.length}

---

## Models Only in Upstream (Add to Extension)

${modelsOnlyInUpstream.length > 0 ? modelsOnlyInUpstream.map((model) => {
  return `### \`${model.id}\`

- **Name:** ${model.id}
- **Owned by:** ${model.owned_by || "unknown"}
- **Created:** ${model.created ? new Date(model.created * 1000).toISOString() : "unknown"}
- **Full model info:**
\`\`\`json
${JSON.stringify(model, null, 2)}
\`\`\`
`;
}).join("\n---\n\n") : "*No models found only in upstream.*"}

---

## Models Only in Extension (Not Found Upstream)

${modelsOnlyInExtension.length > 0 ? modelsOnlyInExtension.map((id) => {
  return `- \`${id}\``;
}).join("\n") : "*All extension models are present upstream.*"}

---

## Models in Both (Up to Date)

${modelsInBoth.length > 0 ? modelsInBoth.map((id) => {
  const upstreamModel = upstreamModels.find((m) => m.id === id);
  return `- \`${id}\` - ${upstreamModel?.owned_by || "unknown"}`;
}).join("\n") : "*No models in common.*"}

---

## Recommended Actions

${modelsOnlyInUpstream.length > 0 ? `
### Add New Models to Extension

The following models are available upstream but not configured in the extension.
To add them, update \`src/langdock.ts\` and add entries to the appropriate provider's \`models\` array:

\`\`\`typescript
{
  id: "<model-id>",
  name: "<Human-readable name>",
  reasoning: false, // or true if it's a reasoning model
  input: ["text"], // or ["text", "image"] for vision models
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: <context_window_size>,
  maxTokens: 8192,
  // For the OpenAI-compatible provider add: compat: openaiCompat
}
\`\`\`

**Models to add:**
${modelsOnlyInUpstream.map((m) => `- [ ] \`${m.id}\``).join("\n")}
` : "All upstream models are already configured in the extension."}

${modelsOnlyInExtension.length > 0 ? `
### Remove or Update Missing Models

The following models are configured in the extension but not found upstream.
They may have been removed or renamed. Consider removing them or updating their IDs:

${modelsOnlyInExtension.map((id) => `- [ ] \`${id}\``).join("\n")}
` : ""}

---

## Full Upstream Models List

| Model ID | Owned By | Created |
|----------|----------|---------|
${upstreamModels.map((m) => `| \`${m.id}\` | ${m.owned_by || "unknown"} | ${m.created ? new Date(m.created * 1000).toISOString().split("T")[0] : "unknown"} |`).join("\n")}
`;

  return markdown;
}

async function main() {
  console.log("Fetching models from Langdock upstream...");
  console.log(`Base URLs: ${LANGDOCK_BASE_URLS.join(", ")}`);
  console.log("");
  console.log("Note: Set LANGDOCK_API_KEY environment variable to access all models.");
  console.log("");

  try {
    // Extract models from extension source code
    const extensionModels = extractExtensionModels();
    console.log(`Extracted ${extensionModels.length} models from extension source`);
    console.log("");

    let upstreamModels: UpstreamModel[];
    try {
      upstreamModels = await fetchUpstreamModels();
    } catch (fetchError) {
      console.error("Failed to fetch from API:", fetchError);
      console.error("");
      console.error("Please ensure LANGDOCK_API_KEY is set correctly.");
      console.error("");
      console.error("Example:");
      console.error("  export LANGDOCK_API_KEY=\"your-api-key\"");
      console.error("  npm run check-upstream");
      console.error("");
      process.exit(1);
    }
    
    console.log(`Found ${upstreamModels.length} models upstream`);
    console.log(`Extension has ${extensionModels.length} models configured`);
    console.log("");

    const report = generateMarkdownReport(upstreamModels, extensionModels);

    fs.writeFileSync(OUTPUT_FILE, report, "utf-8");
    console.log(`Report written to: ${OUTPUT_FILE}`);
    console.log("");

    // Also print a summary to stdout
    const upstreamIds = new Set(upstreamModels.map((m) => m.id));
    const extensionSet = new Set(extensionModels);
    
    const onlyUpstream = upstreamModels.filter((m) => !extensionSet.has(m.id));
    const onlyExtension = extensionModels.filter((id) => !upstreamIds.has(id));

    if (onlyUpstream.length > 0) {
      console.log("Models only in upstream (not in extension):");
      onlyUpstream.forEach((m) => console.log(`  - ${m.id}`));
      console.log("");
    }

    if (onlyExtension.length > 0) {
      console.log("Models only in extension (not upstream):");
      onlyExtension.forEach((id) => console.log(`  - ${id}`));
      console.log("");
    }

    if (onlyUpstream.length === 0 && onlyExtension.length === 0) {
      console.log("✓ Extension models are in sync with upstream!");
    }
  } catch (error) {
    console.error("Failed to generate report:", error);
    process.exit(1);
  }
}

main();
