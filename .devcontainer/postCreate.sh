#!/bin/bash
set -euo pipefail

echo "Installing dependencies..."
pnpm install

echo "Registering Claude Code plugin marketplaces..."
claude plugin marketplace add anthropics/claude-plugins-official
claude plugin marketplace add spencerbeggs/bot
claude plugin marketplace add savvy-web/systems

echo "Making shell scripts executable..."
find . -name "*.sh" -path "*/scripts/*" -type f -exec chmod +x {} \;

echo "Dev container setup complete."
