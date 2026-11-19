# DoraHacks submission — PayCourt (paste-ready)

Event: Aevum Builder Challenge #1 — https://dorahacks.io/hackathon/qday/detail
Deadline: 2026-12-11 16:00 (Beijing/HKT). Submit early; the portal slows down near the deadline.

## Project name

PayCourt

## Tagline

Escrow + adjudication for agent-to-agent payments in tUSD8 on Aevum: funds lock in a contract, delivery releases them, silence refunds them, and a named arbiter settles disputes — with the verdict on-chain.

## Track

Decentralized Payments (with a Native AI Assistants angle: the seller and the judge are agents)

## Description

Agent commerce has a trust problem: a buyer agent that pays first can be ghosted; a seller agent that delivers first can be stiffed. PayCourt moves the money into a neutral contract instead of either wallet.

How it works:

1. A buyer agent hits a paid API and gets an HTTP 402 with escrow terms (x402-style). It signs an EIP-3009 `ReceiveWithAuthorization` — no gas, no pre-approval.
2. A relayer settles the authorization into `EscrowCourt.openCaseWithAuthorization`: the tUSD8 locks in the contract with the seller, a named arbiter, a delivery deadline and a review window.
3. The seller delivers and anchors a proof hash on-chain. The buyer confirms → instant release. Silence after the review window → anyone can finalize the release. No delivery by the deadline → the buyer refunds.
4. On dispute, a judge agent applies a published, deterministic rubric (rubric id `paycourt-rubric-v1`): it re-fetches the seller's delivery from the gateway and compares its hash with the on-chain proof. Match → RELEASE; missing or mismatched proof → REFUND. The verdict and a reason hash go on-chain, auditable by anyone.

Safety by construction: role-isolated state transitions, a per-case amount cap, chain-enforced deadlines, no admin keys, no upgrade path, no fee extraction. Every step emits events, so the whole life of a case is a public audit trail.

Live proof (Aevum testnet, real tUSD8, 2026-11-19): case #1 ran the happy path end-to-end; case #2 was disputed and resolved RELEASE by the judge agent after proof verification. Links are in the repository README.

## Links

- Repository: https://github.com/vlovichot/aevum-paycourt
- EscrowCourt (Aevum testnet): https://explorer-test.qday.info/address/0x69cAd92E78508Dc07caD7F341F29B74b79EAc83c
- Deploy tx: https://explorer-test.qday.info/tx/0xe02eed4db5c9682931e1a5a55eecbdc36139448adde638583d6c73b21501a9da
- Case #1 release tx: https://explorer-test.qday.info/tx/0xfaa2055d670107936e9445e67b1d78e467632f89fbb311450f0fc20c2c8ebef2
- Case #2 verdict tx: https://explorer-test.qday.info/tx/0xb9b91589da33d57ea99fd8c1592a82323dd4e16bd8503b34c6e6207cbfce3b03
- Demo video: https://youtu.be/eGOTiIrOQ8Y

## Team

- wlowic (solo) — design, contracts, gateway, judge agent, web demo

## Built during the challenge window

All code in the repository was written between 2026-11-16 and the submission date, starting from the official aevum-starter-kit template. It reuses the *concept* of an earlier personal experiment with on-chain adjudication, but every line of PayCourt — contract, services, and UI — is new.
