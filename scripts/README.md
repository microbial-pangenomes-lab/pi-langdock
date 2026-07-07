# Scripts

## claude-langdock.sh

A wrapper that launches Claude Code against Langdock's Anthropic-compatible endpoint, without affecting your normal `claude`. Run `scripts/claude-langdock.sh --help`, or see the "Using with Claude Code" section of the top-level [README](../README.md) for options and examples.

## check-upstream-models.ts

This script fetches the list of available models from the Langdock API and generates a markdown report comparing them with the models configured in the extension.

### Prerequisites

You need an Langdock API key. Set it as an environment variable:

```bash
export LANGDOCK_API_KEY="your-api-key"
```

### Usage

```bash
# Using npm script
npm run check-upstream

# Or directly
LANGDOCK_API_KEY="your-api-key" npx tsx scripts/check-upstream-models.ts
```

### Output

The script generates `upstream-models-report.md` in the project root with:

1. **Summary** - Counts of models in upstream, extension, and differences
2. **Models Only in Upstream** - Models available in Langdock but not in the extension (with full JSON details for each)
3. **Models Only in Extension** - Models configured in the extension but not found upstream
4. **Models in Both** - Models that are properly synchronized
5. **Recommended Actions** - Checklist for adding/removing models
6. **Full Upstream Models List** - Table of all upstream models

### Using the Report

The generated markdown report is designed to be used as input for an agent to update the extension. An agent can:

1. Read the report to identify models that need to be added
2. Use the JSON model details to create proper TypeScript model configurations
3. Update `src/langdock.ts` with new model entries
4. Update the README.md model list

### Example Workflow

```bash
# 1. Generate the report
export LANGDOCK_API_KEY="your-api-key"
npm run check-upstream

# 2. Review the report
cat upstream-models-report.md

# 3. Use an agent to update the extension based on the report
# (The report contains all necessary information for automated updates)
```
