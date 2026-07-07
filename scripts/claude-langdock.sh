#!/usr/bin/env bash
#
# Launch Claude Code pointed at Langdock's Anthropic-compatible endpoint (HZI).
# Your normal `claude` is unaffected: these variables are scoped to this
# process only. Run plain `claude` for the real Anthropic API, this wrapper for
# Langdock.
#
set -euo pipefail

# --- Defaults (overridable via flags or environment) ------------------------
REGION="${LANGDOCK_REGION:-eu}"
MODEL="${CLAUDE_LANGDOCK_MODEL:-claude-opus-4-8-default}"
SMALL_MODEL="${CLAUDE_LANGDOCK_SMALL_MODEL:-claude-haiku-4-5-20251001}"
KEY=""        # set by --key
KEY_FILE=""   # set by --key-file
DO_LIST=0

usage() {
  cat <<'EOF'
Launch Claude Code against Langdock (HZI).

Usage:
  claude-langdock.sh [options] [-- claude args...]

Options:
  -m, --model <id|alias>        Main model      (default: claude-opus-4-8-default)
  -s, --small-model <id|alias>  Background model (default: claude-haiku-4-5-20251001)
  -f, --key-file <path>         Read the API key from this file
  -k, --key <key>               API key literal (overrides --key-file / env)
  -r, --region <eu|us>          Langdock region (default: eu)
  -l, --list-models             List models the workspace exposes, then exit
  -h, --help                    Show this help, then exit

Model aliases:
  opus  | opus48  -> claude-opus-4-8-default
  opus46          -> claude-opus-4-6-default
  sonnet| sonnet46-> claude-sonnet-4-6-default
  haiku | haiku45 -> claude-haiku-4-5-20251001

Key resolution order:  --key  >  --key-file  >  $LANGDOCK_API_KEY  >  $LANGDOCK_KEY_FILE
By default the key comes from the $LANGDOCK_API_KEY environment variable.
Anything after `--`, or any unrecognized argument, is passed through to `claude`.

Examples:
  claude-langdock.sh                          # interactive, Opus 4.8
  claude-langdock.sh -m sonnet -p "hi"        # one-shot with Sonnet 4.6
  claude-langdock.sh -f ~/secrets/ld.key      # key from a custom location
  claude-langdock.sh --list-models
  claude-langdock.sh -- -c --verbose          # resume last session, verbose

Caveats: extended thinking is unsupported on Opus 4.8/4.6 and Sonnet 4.6 via
Claude Code (use Haiku 4.5 if you want thinking); Langdock has no
/v1/messages/count_tokens endpoint, so context metering may warn.
EOF
}

resolve_model() {
  case "$1" in
    opus|opus48|opus-4.8|opus-4-8)        echo "claude-opus-4-8-default" ;;
    opus46|opus-4.6|opus-4-6)             echo "claude-opus-4-6-default" ;;
    sonnet|sonnet46|sonnet-4.6|sonnet-4-6) echo "claude-sonnet-4-6-default" ;;
    haiku|haiku45|haiku-4.5|haiku-4-5)    echo "claude-haiku-4-5-20251001" ;;
    *)                                     echo "$1" ;;
  esac
}

# --- Parse arguments --------------------------------------------------------
CLAUDE_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--model)        MODEL="$(resolve_model "$2")"; shift 2 ;;
    --model=*)         MODEL="$(resolve_model "${1#*=}")"; shift ;;
    -s|--small-model)  SMALL_MODEL="$(resolve_model "$2")"; shift 2 ;;
    --small-model=*)   SMALL_MODEL="$(resolve_model "${1#*=}")"; shift ;;
    -f|--key-file)     KEY_FILE="$2"; shift 2 ;;
    --key-file=*)      KEY_FILE="${1#*=}"; shift ;;
    -k|--key)          KEY="$2"; shift 2 ;;
    --key=*)           KEY="${1#*=}"; shift ;;
    -r|--region)       REGION="$2"; shift 2 ;;
    --region=*)        REGION="${1#*=}"; shift ;;
    -l|--list-models)  DO_LIST=1; shift ;;
    -h|--help)         usage; exit 0 ;;
    --)                shift; CLAUDE_ARGS+=("$@"); break ;;
    *)                 CLAUDE_ARGS+=("$1"); shift ;;
  esac
done

# --- Resolve the API key ----------------------------------------------------
# Precedence: --key > --key-file > $LANGDOCK_API_KEY > $LANGDOCK_KEY_FILE.
read_key_file() {
  [[ -r "$1" ]] || { echo "error: key file not readable: $1" >&2; exit 1; }
  tr -d '[:space:]' < "$1"
}

if [[ -n "$KEY" ]]; then
  :                                             # --key literal
elif [[ -n "$KEY_FILE" ]]; then
  KEY="$(read_key_file "$KEY_FILE")"            # --key-file
elif [[ -n "${LANGDOCK_API_KEY:-}" ]]; then
  KEY="$LANGDOCK_API_KEY"                        # default: env variable
elif [[ -n "${LANGDOCK_KEY_FILE:-}" ]]; then
  KEY="$(read_key_file "$LANGDOCK_KEY_FILE")"   # optional env-pointed file
else
  echo "error: no Langdock API key found." >&2
  echo "       set \$LANGDOCK_API_KEY (default), or pass --key / --key-file." >&2
  exit 1
fi

ANTHROPIC_BASE="https://api.langdock.com/anthropic/${REGION}"

# --- --list-models ----------------------------------------------------------
if [[ "$DO_LIST" -eq 1 ]]; then
  for pair in "OpenAI-compatible|https://api.langdock.com/openai/${REGION}/v1/models" \
              "Anthropic-compatible|${ANTHROPIC_BASE}/v1/models"; do
    label="${pair%%|*}"; url="${pair#*|}"
    echo "== ${label} (${REGION}) =="
    curl -s -H "Authorization: Bearer ${KEY}" "$url" \
      | grep -oE '"id"[[:space:]]*:[[:space:]]*"[^"]+"' \
      | sed -E 's/.*"([^"]+)"$/  \1/' \
      || echo "  (request failed)"
    echo
  done
  exit 0
fi

# `env -u ANTHROPIC_API_KEY` drops any real Anthropic key so it can't shadow the
# Langdock auth token below.
exec env -u ANTHROPIC_API_KEY \
  ANTHROPIC_BASE_URL="$ANTHROPIC_BASE" \
  ANTHROPIC_AUTH_TOKEN="$KEY" \
  ANTHROPIC_MODEL="$MODEL" \
  ANTHROPIC_SMALL_FAST_MODEL="$SMALL_MODEL" \
  claude ${CLAUDE_ARGS[@]+"${CLAUDE_ARGS[@]}"}
