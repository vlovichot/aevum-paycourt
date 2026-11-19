# PayCourt — Design

## Problem

AI agents increasingly buy services from other agents (data, compute, content).
Paying a stranger-agent upfront is risky: if the service never arrives, the money
is gone; if the buyer can charge back at will, no seller will serve agents.
Card networks solve this for humans with escrow-like dispute processes.
Agent-to-agent commerce on-chain needs the same primitive, natively:
**funds locked in a contract, released on delivery, refunded on failure,
with a neutral adjudicator for disputes — all auditable on-chain.**

## What PayCourt is

An escrow + adjudication layer for tUSD8 payments on QDay Aevum testnet,
plus an x402-style paywall gateway that uses it, and a deterministic
"judge agent" that resolves disputes.

Track: **Decentralized Payments** (with a Native AI Assistants angle:
both the seller and the judge are agents).

## Components

1. **EscrowCourt.sol** (Foundry, Solidity 0.8.24, Shanghai EVM)
   The single source of truth for money movement. See "Contract" below.
2. **Gateway service** (`services/gateway`, TypeScript + viem)
   An x402-style paywall: a premium API resource answers `402 Payment Required`
   with machine-readable payment instructions. The buyer pays by signing an
   EIP-3009 authorization that funds an escrow case; the gateway (acting as
   facilitator) settles it on-chain, then serves the resource. Delivery is
   therefore *funded-but-locked*, not paid-out: the seller still has to deliver,
   and the buyer keeps dispute rights.
3. **Judge agent** (`services/judge`, TypeScript + viem)
   Polls `CaseDisputed` events (chunked `eth_getLogs`, ≤1,000 blocks per call,
   HTTPS polling — Aevum has no WebSocket RPC), reads the case and its evidence
   hashes, applies a published deterministic rubric, and calls `resolve()`.
   Every verdict carries a `reasonHash` so the reasoning is auditable.
4. **Web demo** (adapted from the official starter kit's Next.js app)
   Setup checker, case creation, delivery confirmation, dispute button,
   case timeline built from events (the audit trail).

## Contract: EscrowCourt

State machine per case:

```
            openCase / openCaseWithAuthorization
                        │
                        ▼
                     OPEN ──── seller never delivers by deadline ──► REFUNDED (buyer claims)
                        │ markDelivered (seller, proof hash)
                        ▼
                   DELIVERED ── buyer confirmRelease ─────────────► RELEASED
                        │     └─ review window passes (anyone) ───► RELEASED
                        │ buyer dispute (within review window)
                        ▼
                    DISPUTED ── judge resolve(RELEASE) ────────────► RELEASED
                             └─ judge resolve(REFUND) ─────────────► REFUNDED
```

Safety / rubric mapping (judging criteria "Safety, trust and controls"):

- **Least privilege**: only the named seller can mark delivery, only the buyer
  can confirm/dispute, only the case's named arbiter can resolve.
- **Budget caps**: `maxCaseAmount` (set at deploy) bounds any single case;
  the judge agent additionally self-limits to cases ≤ its own configured cap.
- **Expiry everywhere**: delivery deadline + review window are per-case,
  on-chain, and enforced by the contract, not by the front end.
- **Idempotency**: case ids are sequential and each transition is one-shot;
  EIP-3009 nonces are consumed by the token contract itself.
- **Audit trail**: every transition emits an event with the evidence/reason
  hashes; nothing moves silently.
- **No custody creep**: the contract holds only locked case funds and pays out
  exactly the case amount to exactly buyer or seller. No fees, no admin
  withdrawal, no upgrade keys.

Funding modes:

1. `openCase` — buyer approves + calls (buyer pays gas).
2. `openCaseWithAuthorization` — buyer signs an EIP-3009
   `ReceiveWithAuthorization` off-chain (to = this contract); anyone (gateway,
   seller, relayer) submits. Buyer needs no tQDAY gas. This is the mode the
   x402 gateway uses.

## Judge rubric (deterministic, published)

For a DISPUTED case the judge checks, in order:

1. Was delivery marked on-chain before the delivery deadline?
   No → **REFUND** (seller never proved delivery).
2. Does the delivery proof hash match the proof the seller committed in
   `markDelivered` and was it submitted before the buyer disputed?
   (It is the same on-chain record — this step guards against post-dispute
   back-filling, which the state machine already forbids.)
3. Did the buyer dispute within the review window? (Contract enforces;
   judge re-checks for the record.)
→ All satisfied → **RELEASE**. Any failure → **REFUND**.

The rubric is intentionally mechanical for the demo: it shows the *slot*
where a smarter adjudicator (LLM judge, human arbitrator, optimistic oracle)
plugs in without changing the money layer. The verdict transaction includes
`reasonHash = keccak256(rubric version + case facts)` so anyone can recompute
and check the judge followed its own rules.

## x402 gateway flow

```
buyer agent ──GET /api/report──► gateway
            ◄──402 {price, token, network, escrowContract, seller, termsHash}──
buyer signs EIP-3009 authorization (value = price, to = EscrowCourt)
buyer agent ──GET /api/report + X-PAYMENT header──► gateway
gateway: openCaseWithAuthorization(...) on-chain → caseId
gateway verifies case OPEN with matching amount/parties → serves report
seller agent marks delivery (proof = hash of report) → buyer confirms
            → RELEASED; or dispute → judge agent resolves
```

## Repo layout

- `contracts/` — Foundry: `src/EscrowCourt.sol`, tests, deploy script
  (forked plumbing from the official starter kit: foundry.toml is Shanghai,
  libs are git submodules).
- `packages/aevum/` — chain config / ABIs / helpers from the starter kit.
- `services/gateway/` — x402 paywall service (new).
- `services/judge/` — judge agent (new).
- `web/` — demo UI (adapted from starter kit).
- `docs/DESIGN.md` — this file.

## Milestones

1. Contract + unit tests (local) ✅ done 2026-11-19
2. Gateway + judge end-to-end on local anvil (scripts/e2e-local.sh, scenarios A/B/C) ✅ done 2026-11-19
3. Deploy to Aevum testnet, run the full flow with real tUSD8
4. Web demo wired to testnet deployment
5. README, demo script, DoraHacks submission
