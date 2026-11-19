#!/usr/bin/env bash
# PayCourt local end-to-end test on plain anvil (chain 31337, MockUSD8).
#
#   Scenario A: gateway purchase -> buyer confirms        -> seller paid
#   Scenario B: gateway purchase -> buyer disputes        -> judge RELEASE (proof matches)
#   Scenario C: direct case, seller fakes delivery proof  -> judge REFUND (no delivery record)
#
# Uses only anvil's well-known throwaway accounts. Run from the repo root:
#   bash scripts/e2e-local.sh
set -euo pipefail
export PATH="$PATH:$HOME/.foundry/bin"
cd "$(dirname "$0")/.."
ROOT=$PWD
RPC=http://127.0.0.1:8545
WORK=$(mktemp -d)
PIDS=()

cleanup() {
  for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done
  echo "logs in $WORK"
}
trap cleanup EXIT

say() { echo; echo "=== $* ==="; }
fail() { echo "E2E FAIL: $*" >&2; exit 1; }

balance() { cast call "$TOKEN" "balanceOf(address)(uint256)" "$1" --rpc-url $RPC | awk '{print $1}'; }
case_state() { curl -s "http://127.0.0.1:8787/api/case/$1" | grep -o '"state": [0-9]*' | awk '{print $2}'; }
wait_state() { # caseId, want, label
  for _ in $(seq 1 30); do [ "$(case_state "$1")" = "$2" ] && return 0; sleep 2; done
  fail "case $1 did not reach state $2 ($3); last state $(case_state "$1")"
}

# ---------------------------------------------------------------- anvil
say "starting anvil"
anvil --hardfork shanghai --port 8545 >"$WORK/anvil.log" 2>&1 &
PIDS+=($!)
for _ in $(seq 1 20); do cast chain-id --rpc-url $RPC >/dev/null 2>&1 && break; sleep 0.5; done

# Parse anvil's printed accounts + keys (throwaway test accounts only).
mapfile -t ADDRS < <(grep -oE '0x[0-9a-fA-F]{40}' "$WORK/anvil.log" | head -10)
mapfile -t KEYS < <(grep -oE '0x[0-9a-fA-F]{64}' "$WORK/anvil.log" | head -10)
DEPLOYER=${ADDRS[0]}; BUYER=${ADDRS[1]}; SELLER=${ADDRS[2]}; JUDGE=${ADDRS[3]}; RELAYER=${ADDRS[4]}
BUYER_KEY=${KEYS[1]}; SELLER_KEY=${KEYS[2]}; JUDGE_KEY=${KEYS[3]}; RELAYER_KEY=${KEYS[4]}
echo "deployer $DEPLOYER"; echo "buyer    $BUYER"; echo "seller   $SELLER"; echo "judge    $JUDGE"; echo "relayer  $RELAYER"

# ---------------------------------------------------------------- deploy
say "deploying EscrowCourt (+ MockUSD8)"
cd contracts
BUYER=$BUYER forge script script/DeployEscrow.s.sol --rpc-url $RPC --broadcast --unlocked --sender "$DEPLOYER" \
  >"$WORK/deploy.log" 2>&1 || { cat "$WORK/deploy.log"; fail "deploy failed"; }
TOKEN=$(grep -E '^\s*token' "$WORK/deploy.log" | grep -oE '0x[0-9a-fA-F]{40}' | head -1)
ESCROW=$(grep -E 'EscrowCourt' "$WORK/deploy.log" | grep -oE '0x[0-9a-fA-F]{40}' | head -1)
cd "$ROOT"
echo "token  $TOKEN"; echo "escrow $ESCROW"
[ "$(balance "$BUYER")" = "1000000000" ] || fail "buyer should start with 1000 tUSD8"

# ---------------------------------------------------------------- env files
cat > services/gateway/.env <<EOF
CHAIN_ID=31337
RPC_URL=$RPC
ESCROW_ADDRESS=$ESCROW
TOKEN_ADDRESS=$TOKEN
SELLER_ADDRESS=$SELLER
ARBITER_ADDRESS=$JUDGE
PRICE=5000000
REVIEW_WINDOW_SECS=900
RELAYER_KEY=$RELAYER_KEY
SELLER_KEY=$SELLER_KEY
EOF
cat > services/judge/.env <<EOF
CHAIN_ID=31337
RPC_URL=$RPC
ESCROW_ADDRESS=$ESCROW
GATEWAY_URL=http://127.0.0.1:8787
POLL_SECS=2
STATE_FILE=$WORK/judge-state.json
JUDGE_KEY=$JUDGE_KEY
EOF
cat > examples/.env <<EOF
RPC_URL=$RPC
BUYER_KEY=$BUYER_KEY
GATEWAY_URL=http://127.0.0.1:8787
EOF

# ---------------------------------------------------------------- services
say "starting gateway + judge"
pnpm --filter gateway start >"$WORK/gateway.log" 2>&1 &
PIDS+=($!)
for _ in $(seq 1 30); do curl -s http://127.0.0.1:8787/health >/dev/null 2>&1 && break; sleep 1; done
curl -s http://127.0.0.1:8787/health | grep -q '"ok": true' || { cat "$WORK/gateway.log"; fail "gateway did not start"; }
pnpm --filter judge start >"$WORK/judge.log" 2>&1 &
PIDS+=($!)
sleep 2

# ---------------------------------------------------------------- scenario A
say "A: purchase + confirm -> seller paid"
pnpm --filter examples buy-report demo-1 --confirm >"$WORK/buy-a.log" 2>&1 || { cat "$WORK/buy-a.log"; fail "scenario A purchase failed"; }
grep -q "confirmed release" "$WORK/buy-a.log" || { cat "$WORK/buy-a.log"; fail "scenario A confirm missing"; }
[ "$(balance "$SELLER")" = "5000000" ] || fail "A: seller should hold 5 tUSD8, holds $(balance "$SELLER")"
[ "$(balance "$ESCROW")" = "0" ] || fail "A: escrow should be empty"
echo "A PASS"

# ---------------------------------------------------------------- scenario B
say "B: purchase + dispute -> judge RELEASE"
pnpm --filter examples buy-report demo-2 --dispute >"$WORK/buy-b.log" 2>&1 || { cat "$WORK/buy-b.log"; fail "scenario B purchase failed"; }
CASE_B=$(grep -oE 'escrow case [0-9]+' "$WORK/buy-b.log" | grep -oE '[0-9]+')
wait_state "$CASE_B" 4 "judge release"
[ "$(balance "$SELLER")" = "10000000" ] || fail "B: seller should hold 10 tUSD8, holds $(balance "$SELLER")"
echo "B PASS (case $CASE_B released by judge)"

# ---------------------------------------------------------------- scenario C
say "C: fake delivery proof -> judge REFUND"
DEADLINE=$(( $(date +%s) + 3600 ))
cast send "$TOKEN" "approve(address,uint256)" "$ESCROW" 5000000 --rpc-url $RPC --unlocked --from "$BUYER" >/dev/null
cast send "$ESCROW" "openCase(address,address,uint256,bytes32,uint64,uint32)" \
  "$SELLER" "$JUDGE" 5000000 "$(cast keccak 'agreement-c')" "$DEADLINE" 900 \
  --rpc-url $RPC --unlocked --from "$BUYER" >/dev/null
CASE_C=$(cast call "$ESCROW" "caseCount()(uint256)" --rpc-url $RPC | awk '{print $1}')
cast send "$ESCROW" "markDelivered(uint256,bytes32)" "$CASE_C" "$(cast keccak 'fake-proof')" \
  --rpc-url $RPC --unlocked --from "$SELLER" >/dev/null
cast send "$ESCROW" "dispute(uint256,bytes32)" "$CASE_C" "$(cast keccak 'buyer-dispute:never-received')" \
  --rpc-url $RPC --unlocked --from "$BUYER" >/dev/null
wait_state "$CASE_C" 5 "judge refund"
[ "$(balance "$BUYER")" = "990000000" ] || fail "C: buyer should be back to 990 tUSD8, holds $(balance "$BUYER")"
[ "$(balance "$ESCROW")" = "0" ] || fail "C: escrow should be empty"
echo "C PASS (case $CASE_C refunded by judge)"

say "E2E ALL PASS"
grep -h "judge" "$WORK/judge.log" | tail -4 || true
