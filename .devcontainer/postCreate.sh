#!/bin/bash
set -euo pipefail

echo "Installing dependencies..."
pnpm install

echo "Registering Claude Code plugin marketplaces..."
claude plugin marketplace add anthropics/claude-plugins-official
claude plugin marketplace add spencerbeggs/bot
claude plugin marketplace add savvy-web/systems

echo "Dev container setup complete."
