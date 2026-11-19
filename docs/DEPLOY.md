# Deploying PayCourt to QDay Aevum testnet

Status: **EscrowCourt DEPLOYED 2026-11-19; web demo (/paycourt) built and wired** via signing option **B**
(Remix + MetaMask, user confirmed). Address
`0x69cAd92E78508Dc07caD7F341F29B74b79EAc83c`, deploy tx
`0xe02eed4db5c9682931e1a5a55eecbdc36139448adde638583d6c73b21501a9da`;
verified on-chain (token = real tUSD8, maxCaseAmount = 100000000,
deployment cost ≈ 0.0011 tQDAY). Next: step 3/4 live flow.
Repo is public: https://github.com/vlovichot/aevum-paycourt — Remix has the
flattened contract loaded from that repo, compiled with solc 0.8.24 /
EVM shanghai / optimizer 200, constructor args filled
(token = real tUSD8, maxCase = 100000000). Remaining user clicks are listed
in step 1B.
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
- **B. Remix + MetaMask** ✅ CHOSEN: deploy `EscrowCourt` from the cloud browser with
  MetaMask; the user confirms the transaction himself. Constructor args:
  token `0x456569838f1d43009A91ebA4263147Afd7233483`, maxCase `100000000`.

### 1B. Handover state (2026-11-19)

Remix (app.remix.live) is open in the cloud browser with
`contracts/flattened/EscrowCourt.flat.sol` loaded from the public repo,
compiled (0.8.24 / shanghai / optimizer 200), Deploy panel set to
EscrowCourt with constructor args filled. The user now:
1. Environment dropdown → "Injected Provider - MetaMask"; unlock/connect
   account 0x6Fde…F619 in the MetaMask popup.
2. Add/switch MetaMask to QDay Aevum Testnet (chain 44005,
   RPC https://rpc-test.qday.info, symbol tQDAY,
   explorer https://explorer-test.qday.info).
3. Click Deploy in Remix; confirm the creation transaction in MetaMask.
Then the assistant reads the deployed address and continues at step 3.
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
mock anywhere except plain anvil). Recorded:

- EscrowCourt address: `0x69cAd92E78508Dc07caD7F341F29B74b79EAc83c`
- Deploy tx: `0xe02eed4db5c9682931e1a5a55eecbdc36139448adde638583d6c73b21501a9da`

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
