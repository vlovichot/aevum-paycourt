# Deploying PayCourt to QDay Aevum testnet

Status: **not yet deployed** — waiting on the deploy-signature decision (step 1).
Everything below is rehearsed locally (`scripts/e2e-local.sh`).

## 0. Prerequisites (done)

- [x] DoraHacks registration (secwlowic@gmail.com)
- [x] Starter kit + Starter Guide V4 reviewed; constraints noted
      (Shanghai EVM, ≤1,000-block log reads, no WebSocket RPC, explorer
      contract verification unavailable → link addresses in the submission)
- [x] Test funds claimed to the deploy/buyer wallet
      `0x6Fde04DeAF5809d689F02398f53FF5185439F619`: **1 tQDAY + 5 tUSD8**
      (verified on-chain via the explorer API)

## 1. Decide how the deploy transaction is signed

The deployer is `0x6Fde…F619` (it holds the tQDAY for gas). The private key
never goes through chat and is never handled by the assistant. Pick one:

- **A. Foundry keystore (recommended)**: the user runs
  `cast wallet import aevum-deployer --interactive` once on this machine and
  types the key into the terminal prompt himself. Afterwards deployments run
  non-interactively with `--account aevum-deployer`, no key material in any
  file the assistant writes.
- **B. Remix + MetaMask**: deploy `EscrowCourt` from the cloud browser with
  MetaMask; the user confirms the transaction himself. Constructor args:
  token `0x456569838f1d43009A91ebA4263147Afd7233483`, maxCase `100000000`.
- **C. User runs the forge command himself** in a terminal session with his
  own key handling; assistant provides the exact command.

## 2. Deploy

Option A/C command (from repo root):

```bash
cd contracts
forge script script/DeployEscrow.s.sol \
  --rpc-url https://rpc-test.qday.info \
  --broadcast --legacy --account aevum-deployer
```

Expected: token resolves to the real tUSD8 (the script refuses to deploy a
mock anywhere except plain anvil). Record:

- EscrowCourt address: _TBD_
- Deploy tx: _TBD_

## 3. Point the services at testnet

- `services/gateway/.env`: `CHAIN_ID=44005`, `RPC_URL=https://rpc-test.qday.info`,
  `ESCROW_ADDRESS=<deployed>`, token defaults to real tUSD8,
  `SELLER_ADDRESS` / `ARBITER_ADDRESS` = the demo seller/judge wallets
  (fresh throwaway testnet wallets, funded with a little tQDAY each —
  creating/funding them is a user-approved step, amounts are testnet dust).
- `services/judge/.env`: same chain/RPC/escrow, `JUDGE_KEY` for the arbiter
  wallet, `GATEWAY_URL` where the gateway is reachable.
- `examples/.env`: `RPC_URL=https://rpc-test.qday.info`, `BUYER_KEY` for a
  buyer wallet holding tUSD8 (the claim wallet has exactly 5 tUSD8 = one
  demo purchase at the default price; keep the demo price at 5 or lower it).

## 4. Live-fire checklist (all on Aevum testnet)

- [ ] Gateway `/health` shows chain 44005 + deployed escrow
- [ ] Buyer agent buys a report (case opened with real tUSD8, locked)
- [ ] Delivery marked on-chain; buyer confirms → seller balance +price
- [ ] Second purchase disputed → judge resolves; verdict + reason hash on-chain
- [ ] Explorer links for: deploy tx, case-open tx, release tx, verdict tx
- [ ] Fill the addresses into README.md and the DoraHacks submission

## 5. Submission (before 2026-12-11 16:00 CST)

- [ ] Push this repo to a public GitHub repo; open it logged-out to verify
- [ ] No keys/.env/secrets in the tree or history (`git log -p | grep` check)
- [ ] Demo video (2–3 min, link publicly viewable) + be ready for the
      top-5 live video-call demo (2026-12-15 14:00 HKT)
- [ ] Submit on https://dorahacks.io/hackathon/qday/detail
