#!/bin/sh
set -e

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

# Run database migrations
echo "Running database migrations..."
npx prisma migrate deploy
echo "Migrations complete."

# Execute the main command
exec "$@"
