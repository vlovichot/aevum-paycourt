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

## Narration track (record silent video; voiceover added in post, 2026-11-19)

The user records picture only; the assistant synthesizes this English
voiceover and mixes it to the scene timings. ~150 wpm.

- S1 (0:00–0:20, repo page): "PayCourt is an escrow and adjudication layer for agent-to-agent payments in tUSD8 on Aevum. In agent commerce, whoever moves first gets burned — so PayCourt moves the money into a neutral contract instead."
- S2 (0:20–0:45, /paycourt board): "Every case is a state machine on-chain: a buyer, a seller, a named arbiter, an amount, a delivery deadline and a review window. No admin keys, no upgrade path, no fees. This board reads the live contract — these two cases are real, settled with real testnet tUSD8."
- S3 (0:45–1:15, case #1 release tx): "Case one. A buyer agent asked a gateway for a data report and got an HTTP 402 with escrow terms. It paid by signing an EIP-3009 authorization — no gas, no pre-approval. The gateway locked two tUSD8 in EscrowCourt, the seller delivered and anchored a proof hash, the buyer confirmed, and the seller was paid. This is the release transaction."
- S4 (1:15–1:50, case #2 verdict tx): "Case two. Same purchase — but this time the buyer disputed. Our judge agent picked up the dispute on its own, fetched the seller's delivery from the gateway, and compared its hash with the proof locked on-chain. They matched, so under the published rubric it ruled RELEASE. The verdict and its reason hash are recorded in this transaction — anyone can audit why the judge decided what it decided."
- S5 (1:50–2:20, contract source on GitHub): "The contract enforces the deadlines itself. No delivery by the deadline, the buyer can refund. Delivery with no dispute inside the review window, anyone can finalize the release. Only the named arbiter can resolve a dispute, and every step emits events — a complete public audit trail."
- S6 (2:20–2:40, README live-run section): "Smart contract, x402-style gateway, judge agent, and web board — all open source, all built fresh during this challenge. PayCourt: agent commerce, with a court built in. Thank you."

Recording staging (2026-11-19): the five scenes are open as tabs in the cloud
browser in order — GitHub repo, /paycourt board (local server on :3100),
explorer contract page, case #1 tx, case #2 tx. The contract-source scene (S5)
is the repo's contracts/src/EscrowCourt.sol page (open from the repo tab).
