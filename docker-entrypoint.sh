#!/bin/sh
set -e

# Write Claude Code credentials from env vars if provided
if [ -n "$CLAUDE_OAUTH_TOKEN" ]; then
  CLAUDE_DIR="$HOME/.claude"
  mkdir -p "$CLAUDE_DIR"

  # Calculate expiresAt (24 hours from now in milliseconds)
  EXPIRES_AT=$(node -e "console.log(Date.now() + 86400000)")

  cat > "$CLAUDE_DIR/.credentials.json" << CREDENTIALS_EOF
{
  "claudeAiOauth": {
    "accessToken": "$CLAUDE_OAUTH_TOKEN",
    "refreshToken": "${CLAUDE_OAUTH_REFRESH_TOKEN:-}",
    "expiresAt": $EXPIRES_AT,
    "scopes": ["user:inference","user:profile"],
    "subscriptionType": "max"
  }
}
CREDENTIALS_EOF

  chmod 600 "$CLAUDE_DIR/.credentials.json"
  echo "Claude Code credentials written to $CLAUDE_DIR/.credentials.json"
fi

# Run database migrations
echo "Running database migrations..."
npx prisma migrate deploy
echo "Migrations complete."

# Execute the main command
exec "$@"
