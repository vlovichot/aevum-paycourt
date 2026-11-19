/**
 * PayCourt judge agent — the arbiter named in escrow cases.
 *
 * Polls EscrowCourt for CaseDisputed events (chunked eth_getLogs, HTTPS
 * polling — Aevum has no WebSocket RPC), evaluates each disputed case against
 * a published deterministic rubric, and submits the verdict on-chain with a
 * reason hash anyone can recompute:
 *
 *   1. No delivery proof committed on-chain            -> REFUND
 *   2. Seller's storefront has no record of the delivery -> REFUND
 *      (or its proof hash differs from the on-chain one)
 *   3. Proof matches the delivery the buyer received     -> RELEASE
 *
 * Self-imposed controls (see docs/DESIGN.md):
 *   - Only resolves cases where it is the named arbiter.
 *   - Refuses cases above JUDGE_MAX_CASE (left for manual review).
 *   - Never decides without evidence: if the storefront is unreachable the
 *     case stays pending and is retried next poll.
 *   - State (scan watermark + pending + verdicts) persists in a JSON file so
 *     restarts are safe and every case is resolved at most once.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseAbiItem,
  toBytes,
  zeroHash,
  type Address,
  type Chain,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { aevumFork, aevumTestnet, CaseState, escrowCourtAbi, getLogsChunked, localAnvil } from "@aevum-kit/aevum";

// ------------------------------------------------------------------ config

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`missing env ${name} (see .env.example)`);
  return v;
}

const CHAIN_ID = Number(env("CHAIN_ID", "31337"));
const RPC_URL = env("RPC_URL", "http://127.0.0.1:8545");
const ESCROW_ADDRESS = env("ESCROW_ADDRESS") as Address;
const GATEWAY_URL = env("GATEWAY_URL", "http://127.0.0.1:8787");
const POLL_SECS = Number(env("POLL_SECS", "15"));
const JUDGE_MAX_CASE = BigInt(env("JUDGE_MAX_CASE", "100000000")); // 100 tUSD8
const STATE_FILE = env("STATE_FILE", ".judge-state.json");
const RUBRIC_VERSION = "paycourt-rubric-v1";

const judge = privateKeyToAccount(env("JUDGE_KEY") as Hex);
const baseChain: Chain = CHAIN_ID === aevumTestnet.id ? aevumTestnet : CHAIN_ID === aevumFork.id ? aevumFork : localAnvil;
const chain: Chain = { ...baseChain, id: CHAIN_ID };
const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
const judgeClient = createWalletClient({ account: judge, chain, transport: http(RPC_URL) });

const caseDisputedEvent = parseAbiItem("event CaseDisputed(uint256 indexed caseId, bytes32 disputeReasonHash)");

// ------------------------------------------------------------------ state

interface JudgeState {
  lastScannedBlock: string;
  pending: string[];
  processed: Record<string, { verdict: string; txHash?: string; reasonHash?: string; note?: string }>;
}

function loadState(): JudgeState {
  if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, "utf8")) as JudgeState;
  return { lastScannedBlock: "0", pending: [], processed: {} };
}

function saveState(s: JudgeState) {
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

// ------------------------------------------------------------------ rubric

async function evaluate(caseId: bigint): Promise<{ release: boolean; reasonHash: Hex; facts: string } | "defer"> {
  const c = await publicClient.readContract({
    address: ESCROW_ADDRESS,
    abi: escrowCourtAbi,
    functionName: "getCase",
    args: [caseId],
  });

  let proofMatch = false;
  if (c.deliveryProofHash === zeroHash) {
    proofMatch = false; // rubric step 1: nothing was ever delivered
  } else {
    let proofRes: Response;
    try {
      proofRes = await fetch(`${GATEWAY_URL}/api/proof/${caseId}`);
    } catch {
      return "defer"; // storefront unreachable: never decide without evidence
    }
    if (proofRes.status === 404) {
      proofMatch = false; // rubric step 2: seller has no record of this delivery
    } else if (!proofRes.ok) {
      return "defer";
    } else {
      const body = (await proofRes.json()) as { proofHash: string };
      proofMatch = body.proofHash.toLowerCase() === c.deliveryProofHash.toLowerCase();
    }
  }

  const release = c.deliveryProofHash !== zeroHash && proofMatch;
  const facts = `${RUBRIC_VERSION}|case=${caseId}|deliveredAt=${c.deliveredAt}|deadline=${c.deliveryDeadline}|proofMatch=${proofMatch}`;
  return { release, reasonHash: keccak256(toBytes(facts)), facts };
}

// ------------------------------------------------------------------ polling

async function poll(state: JudgeState) {
  const head = await publicClient.getBlockNumber();
  const from = BigInt(state.lastScannedBlock) + 1n;
  if (from <= head) {
    const logs = await getLogsChunked(publicClient, {
      address: ESCROW_ADDRESS,
      event: caseDisputedEvent,
      fromBlock: from,
      toBlock: head,
    });
    for (const log of logs) {
      if (log.args.caseId === undefined) continue;
      const id = log.args.caseId.toString();
      if (!state.processed[id] && !state.pending.includes(id)) {
        state.pending.push(id);
        console.log(`[judge] dispute seen: case ${id}`);
      }
    }
    state.lastScannedBlock = head.toString();
  }

  for (const idStr of [...state.pending]) {
    const caseId = BigInt(idStr);
    const c = await publicClient.readContract({
      address: ESCROW_ADDRESS,
      abi: escrowCourtAbi,
      functionName: "getCase",
      args: [caseId],
    });
    if (c.state !== CaseState.Disputed) {
      state.processed[idStr] = { verdict: "closed-elsewhere", note: `state=${c.state}` };
      state.pending = state.pending.filter((p) => p !== idStr);
      continue;
    }
    if (c.arbiter.toLowerCase() !== judge.address.toLowerCase()) {
      state.processed[idStr] = { verdict: "not-our-case", note: `arbiter=${c.arbiter}` };
      state.pending = state.pending.filter((p) => p !== idStr);
      continue;
    }
    if (c.amount > JUDGE_MAX_CASE) {
      state.processed[idStr] = { verdict: "manual-review", note: `amount ${c.amount} above cap ${JUDGE_MAX_CASE}` };
      state.pending = state.pending.filter((p) => p !== idStr);
      console.log(`[judge] case ${idStr}: amount above self-imposed cap, left for manual review`);
      continue;
    }

    const verdict = await evaluate(caseId);
    if (verdict === "defer") {
      console.log(`[judge] case ${idStr}: evidence unavailable, will retry`);
      continue;
    }
    const txHash = await judgeClient.writeContract({
      address: ESCROW_ADDRESS,
      abi: escrowCourtAbi,
      functionName: "resolve",
      args: [caseId, verdict.release, verdict.reasonHash],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      console.error(`[judge] case ${idStr}: resolve tx reverted (${txHash}), will retry`);
      continue;
    }
    state.processed[idStr] = {
      verdict: verdict.release ? "RELEASE" : "REFUND",
      txHash,
      reasonHash: verdict.reasonHash,
    };
    state.pending = state.pending.filter((p) => p !== idStr);
    console.log(`[judge] case ${idStr}: ${verdict.release ? "RELEASE" : "REFUND"} (${verdict.facts}) tx ${txHash}`);
  }
  saveState(state);
}

async function main() {
  const once = process.argv.includes("--once");
  const state = loadState();
  console.log(`[judge] arbiter ${judge.address}, escrow ${ESCROW_ADDRESS}, chain ${CHAIN_ID}`);
  for (;;) {
    try {
      await poll(state);
    } catch (e) {
      console.error("[judge] poll failed:", e instanceof Error ? e.message : e);
    }
    if (once) break;
    await new Promise((r) => setTimeout(r, POLL_SECS * 1000));
  }
}

void main();
