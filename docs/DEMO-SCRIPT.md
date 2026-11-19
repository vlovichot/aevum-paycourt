# PayCourt — demo video script (target 2–3 minutes)

Record the cloud-browser screen (or a local browser pointed at the same pages).
Narration can be read from the "Say" lines. Everything below already happened
live on 2026-11-19; for the video, either replay it fresh (needs ~4 tUSD8 in
the buyer wallet again) or walk through the recorded evidence (Option B,
zero new transactions — recommended).

## Option B — evidence walkthrough (no new funds needed)

| Time | Show | Say |
| --- | --- | --- |
| 0:00–0:20 | GitHub repo README, scroll to the flow diagram | "PayCourt is an escrow and adjudication layer for agent-to-agent payments in tUSD8 on Aevum. Agents don't get paid on promises — money locks in a contract first." |
| 0:20–0:45 | The /paycourt page of the web demo (case board with cases #1 and #2, both Released) | "Every case is a contract state machine: buyer, seller, arbiter, amount, deadlines — all on-chain, no admin, no fees." |
| 0:45–1:15 | Explorer: EscrowCourt address page → case #1 transactions | "Case one: an AI buyer paid for a data report through an x402-style gateway. It signed an EIP-3009 authorization — no gas for the buyer — the gateway locked 2 tUSD8 in escrow, the seller delivered, the buyer confirmed, the seller was paid." |
| 1:15–1:50 | Explorer: case #2 dispute tx, then the judge's resolve tx; show the verdict reason hash | "Case two: the buyer disputed. Our judge agent picked up the dispute, compared the seller's delivery proof against the hash locked on-chain, and ruled RELEASE under a published rubric. The ruling and its reason hash are on-chain — auditable by anyone." |
| 1:50–2:20 | EscrowCourt.sol source (GitHub), highlight the role checks and state machine | "The contract enforces the deadlines itself: no delivery, the buyer refunds; no dispute in the review window, payment auto-releases. Only the named arbiter can resolve a dispute." |
| 2:20–2:40 | README live-run section + repo tree (gateway, judge, web) | "Contracts, an x402 gateway, a judge agent, and this web board — all open source, all built fresh during the challenge window. PayCourt: agent commerce with a court built in." |

## Option A — fresh live replay (only if a retake is wanted)

1. Fund the buyer wallet again (same seed-transfer step as 2026-11-19).
2. Start gateway + judge from `services/` (env files already configured).
3. Screen-record the terminal: `buy-report.ts alpha --confirm`, then
   `buy-report.ts beta --dispute`, wait for the judge log line, then show the
   case board in the web demo.

## Checklist

- [ ] Video ≤ 3 minutes, public link (YouTube unlisted or similar), no login needed to view
- [ ] Link pasted into docs/SUBMISSION.md and the DoraHacks form
