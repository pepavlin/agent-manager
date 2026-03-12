#!/bin/sh
set -e

# Ensure upload directory exists (mkdir -p won't fail if it already exists)
mkdir -p "${STORAGE_PATH:-/app/data/uploads}" 2>/dev/null || true

CLAUDE_DIR="$HOME/.claude"
mkdir -p "$CLAUDE_DIR"

# Support CLAUDE_CODE_OAUTH_TOKEN (preferred) with fallback to legacy CLAUDE_OAUTH_TOKEN
OAUTH_TOKEN="${CLAUDE_CODE_OAUTH_TOKEN:-$CLAUDE_OAUTH_TOKEN}"

if [ -n "$OAUTH_TOKEN" ]; then
  # Export as CLAUDE_CODE_OAUTH_TOKEN so Claude CLI picks it up natively
  export CLAUDE_CODE_OAUTH_TOKEN="$OAUTH_TOKEN"

  # Also write .credentials.json as fallback for older Claude CLI versions
  EXPIRES_AT=4102444800000

  cat > "$CLAUDE_DIR/.credentials.json" << CREDENTIALS_EOF
{
  "claudeAiOauth": {
    "accessToken": "$OAUTH_TOKEN",
    "refreshToken": "${CLAUDE_OAUTH_REFRESH_TOKEN:-}",
    "expiresAt": $EXPIRES_AT,
    "scopes": ["user:inference","user:profile"],
    "subscriptionType": "max"
  }
}
CREDENTIALS_EOF

  chmod 600 "$CLAUDE_DIR/.credentials.json"
  echo "Claude Code OAuth token configured"
fi

# Create ~/.claude.json to skip interactive onboarding (required for headless usage)
if [ ! -f "$HOME/.claude.json" ]; then
  CLAUDE_VERSION=$(claude --version 2>/dev/null || echo "1.0.0")

  cat > "$HOME/.claude.json" << ONBOARDING_EOF
{
  "hasCompletedOnboarding": true,
  "lastOnboardingVersion": "$CLAUDE_VERSION"
}
ONBOARDING_EOF

  echo "Claude Code onboarding bypass configured (version: $CLAUDE_VERSION)"
fi

# Pull Ollama embedding model if using ollama provider
if [ "${EMBEDDING_PROVIDER:-ollama}" = "ollama" ]; then
  OLLAMA_MODEL="${OLLAMA_EMBEDDING_MODEL:-nomic-embed-text}"
  OLLAMA_HOST="${OLLAMA_BASE_URL:-http://ollama:11434}"
  echo "Waiting for Ollama at $OLLAMA_HOST..."
  OLLAMA_READY=false
  for i in $(seq 1 30); do
    if wget -q -O /dev/null "$OLLAMA_HOST/" 2>/dev/null; then
      echo "Ollama is ready."
      OLLAMA_READY=true
      break
    fi
    sleep 2
  done

  if [ "$OLLAMA_READY" = "true" ]; then
    echo "Pulling Ollama embedding model: $OLLAMA_MODEL (this may take a while on first run)..."
    # Use wget — available on Alpine by default. Must consume full streamed response.
    PULL_RESULT=$(wget -q -O - --post-data="{\"name\": \"$OLLAMA_MODEL\", \"stream\": false}" \
      --header="Content-Type: application/json" \
      "$OLLAMA_HOST/api/pull" 2>&1) || true
    if echo "$PULL_RESULT" | grep -q '"status":"success"'; then
      echo "Ollama embedding model '$OLLAMA_MODEL' is ready."
    else
      echo "Warning: Ollama pull response: $PULL_RESULT"
      echo "Trying to verify model exists..."
      # Check if model is already available
      if wget -q -O - --post-data="{\"model\": \"$OLLAMA_MODEL\", \"input\": \"test\"}" \
        --header="Content-Type: application/json" \
        "$OLLAMA_HOST/api/embed" > /dev/null 2>&1; then
        echo "Model '$OLLAMA_MODEL' is available."
      else
        echo "WARNING: Ollama model '$OLLAMA_MODEL' may not be available. Embeddings will fail."
      fi
    fi
  else
    echo "WARNING: Ollama not reachable at $OLLAMA_HOST after 60s. Embeddings will fail."
  fi
fi

# Run database migrations
echo "Running database migrations..."
npx prisma migrate deploy
echo "Migrations complete."

# Execute the main command
exec "$@"
