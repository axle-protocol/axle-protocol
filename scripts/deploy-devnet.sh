#!/bin/bash
# AXLE Protocol — Devnet Deployment Script
set -e

export PATH="/Users/hyunwoo/.local/share/solana/install/active_release/bin:$PATH"
source "$HOME/.cargo/env" 2>/dev/null || true

PROJECT_ROOT="/Users/hyunwoo/.openclaw/workspace/option-c"
CONTRACT_DIR="$PROJECT_ROOT/contracts/agent_protocol"
DEPLOY_DIR="$CONTRACT_DIR/target/deploy"
SO_FILE="$DEPLOY_DIR/agent_protocol.so"
KEYPAIR_FILE="$DEPLOY_DIR/agent_protocol-keypair.json"
IDL_FILE="$CONTRACT_DIR/target/idl/agent_protocol.json"

echo "=== AXLE Protocol Devnet Deployment ==="
echo ""

# Check binary exists
if [ ! -f "$SO_FILE" ]; then
  echo "ERROR: Binary not found at $SO_FILE"
  echo "Run the build first:"
  echo "  cd $CONTRACT_DIR"
  echo "  cargo-build-sbf --tools-version v1.52 --manifest-path programs/agent_protocol/Cargo.toml"
  exit 1
fi
echo "[1/5] Binary found: $(du -h "$SO_FILE" | cut -f1)"

# Check deployer balance
DEPLOYER=$(solana address)
BALANCE=$(solana balance --url devnet | cut -d' ' -f1)
echo "[2/5] Deployer: $DEPLOYER (Balance: $BALANCE SOL)"

if (( $(echo "$BALANCE < 3" | bc -l) )); then
  echo ""
  echo "WARNING: Need ~3 SOL for deployment. Current: $BALANCE SOL"
  echo ""
  echo "Get devnet SOL:"
  echo "  Option 1: solana airdrop 2 --url devnet"
  echo "  Option 2: Visit https://faucet.solana.com"
  echo "  Option 3: Visit https://solfaucet.com"
  echo ""
  read -p "Continue anyway? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then exit 1; fi
fi

# Program address
PROGRAM_ID=$(solana address -k "$KEYPAIR_FILE")
echo "[3/5] Program ID: $PROGRAM_ID"

# Deploy
echo "[4/5] Deploying to devnet..."
solana program deploy "$SO_FILE" \
  --program-id "$KEYPAIR_FILE" \
  --url devnet \
  --with-compute-unit-price 1000 \
  -v

echo ""
echo "[5/5] Updating IDL and SDK..."

# Copy IDL to SDK
if [ -f "$IDL_FILE" ]; then
  cp "$IDL_FILE" "$PROJECT_ROOT/sdk/src/idl/agent_protocol.json"
  cp "$IDL_FILE" "$PROJECT_ROOT/plugin/src/idl/agent_protocol.json"
  echo "  IDL copied to sdk/ and plugin/"
fi

echo ""
echo "=== Deployment Complete ==="
echo "Program ID: $PROGRAM_ID"
echo "Explorer:   https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"
echo ""
echo "Next steps:"
echo "  1. cd $PROJECT_ROOT/sdk && npm run build"
echo "  2. Test: npx tsx scripts/test-devnet.ts"
echo "  3. Publish: cd sdk && npm publish --access public"
