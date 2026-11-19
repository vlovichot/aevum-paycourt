# PayCourt

**Escrow + adjudication for agent-to-agent service payments, in tUSD8 on QDay Aevum testnet.**

AI agents increasingly buy services from other agents — data, compute, content.
Paying a stranger-agent upfront is risky: if the service never arrives, the money
is gone; if buyers can claw back at will, no seller will serve agents. PayCourt
is the missing primitive: payment is **locked in a contract**, released on
delivery, refunded on failure, and disputes are resolved by a neutral
**judge agent** applying a published, deterministic rubric — every step
auditable on-chain.

Built for the **Aevum Builder Challenge #1** (track: Decentralized Payments).
Design rationale lives in [docs/DESIGN.md](docs/DESIGN.md); testnet deployment
steps in [docs/DEPLOY.md](docs/DEPLOY.md).

## How it works

```
buyer agent ──GET /api/report──► gateway (seller storefront)
            ◄──402 Payment Required {price, escrow, seller, arbiter, terms}──
buyer signs an EIP-3009 authorization (off-chain, no gas)
buyer agent ──GET + X-PAYMENT──► gateway
gateway settles the authorization into a LOCKED escrow case on-chain,
marks delivery with the content's proof hash, and serves the report
buyer ──confirm──► seller paid        buyer ──dispute──► judge agent
judge checks the on-chain proof against the seller's delivery record
      ──► RELEASE (proof matches)  or  REFUND (no / mismatched proof)
```

Safety properties, enforced by the contract rather than by trust:

- **Deadlines on-chain**: no delivery by the deadline → buyer reclaims;
  delivered and undisputed past the review window → auto-release.
- **Least privilege**: only the seller can mark delivery, only the buyer can
  confirm/dispute, only the case's named arbiter can resolve.
- **Budget cap**: a single case can never exceed `maxCaseAmount`.
- **Audit trail**: every transition emits an event with evidence/reason
  hashes; verdicts carry a `reasonHash` anyone can recompute from the
  judge's published rubric (`paycourt-rubric-v1`, see `services/judge`).
- **No custody creep**: the contract holds only locked case funds, takes no
  fees, and has no admin withdrawal or upgrade path.

## Repo layout

| Path | What |
| --- | --- |
| `contracts/` | Foundry. `src/EscrowCourt.sol` (ours), tests, deploy scripts. Forked plumbing from the official starter kit. |
| `packages/aevum/` | `@aevum-kit/aevum`: chain config, ABIs (incl. EscrowCourt), EIP-3009 + chunked-log helpers. |
| `services/gateway/` | x402-style paywall: 402 → settle authorization into an escrow case → deliver. |
| `services/judge/` | Judge agent: polls disputes, applies the rubric, resolves on-chain. |
| `examples/` | `buy-report`: a buyer agent CLI (402 → sign → pay → confirm/dispute). |
| `web/` | Demo UI (adapted from the starter kit; wiring in progress). |
| `scripts/e2e-local.sh` | Full local end-to-end test, three scenarios. |

## Quickstart (local, no funds needed)

Prereqs: Node 22+, pnpm, Foundry (`foundryup`).

```bash
pnpm install
(cd contracts && forge test)        # 26 unit tests (EscrowCourt + Checkout)
bash scripts/e2e-local.sh            # full flow on local anvil, see below
```

The e2e script boots anvil, deploys EscrowCourt + a mock tUSD8, starts the
gateway and judge, and verifies three scenarios end to end:

- **A** — purchase, buyer confirms → seller paid.
- **B** — purchase, buyer disputes → judge verifies the delivery proof → RELEASE.
- **C** — seller fakes a delivery proof off-gateway, buyer disputes →
  judge finds no delivery record → REFUND.

## Network

QDay Aevum testnet: chain `44005`, RPC `https://rpc-test.qday.info`,
explorer `https://explorer-test.qday.info`. tUSD8:
`0x456569838f1d43009A91ebA4263147Afd7233483` (6 decimals, EIP-3009 capable).
Contracts compile for **Shanghai** (`evm_version = "shanghai"` — Cancun
opcodes fail on-chain). `eth_getLogs` is capped at 1,000 blocks per call and
there is no WebSocket RPC; services poll with chunked log reads.

Testnet deployment: **EscrowCourt on QDay Aevum testnet (44005)** —
[`0x69cAd92E78508Dc07caD7F341F29B74b79EAc83c`](https://explorer-test.qday.info/address/0x69cAd92E78508Dc07caD7F341F29B74b79EAc83c),
deploy tx
[`0xe02eed4db5c9682931e1a5a55eecbdc36139448adde638583d6c73b21501a9da`](https://explorer-test.qday.info/tx/0xe02eed4db5c9682931e1a5a55eecbdc36139448adde638583d6c73b21501a9da)
(deployed 2026-11-19 via Remix + MetaMask; verified on-chain:
token = real tUSD8, maxCaseAmount = 100 tUSD8).

## Credits

Scaffolded from the official
[qday-io/aevum-starter-kit](https://github.com/qday-io/aevum-starter-kit)
(Foundry/Next.js plumbing, chain config, EIP-3009 helpers). EscrowCourt, the
gateway, the judge agent and the buyer agent are original work written for
this challenge during the build window.
