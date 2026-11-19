/**
 * PayCourt gateway — an x402-style paywall in front of a premium API resource.
 *
 * Flow (see docs/DESIGN.md):
 *   1. GET /api/report/:id without payment  -> 402 + machine-readable terms.
 *   2. The buyer agent signs an EIP-3009 authorization (value = price,
 *      to = EscrowCourt) and retries with an X-PAYMENT header.
 *   3. The gateway verifies the signature off-chain, then settles on-chain by
 *      opening an escrow case funded by that authorization. The money is
 *      LOCKED in EscrowCourt, not paid out — the seller still has to deliver.
 *   4. The gateway (acting for the seller) marks delivery with the proof hash
 *      of the served content and returns the content. The buyer then confirms
 *      release, or disputes and lets the judge agent resolve.
 *
 * The gateway is the seller's storefront + facilitator combined, for demo
 * purposes. Keys come from .env and must be throwaway TEST wallets only.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseEventLogs,
  parseSignature,
  toBytes,
  verifyTypedData,
  type Address,
  type Chain,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  aevumFork,
  aevumTestnet,
  escrowCourtAbi,
  localAnvil,
  receiveWithAuthorizationTypes,
  tusd8Domain,
  TUSD8_ADDRESS,
} from "@aevum-kit/aevum";

// ------------------------------------------------------------------ config

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`missing env ${name} (see .env.example)`);
  return v;
}

const CHAIN_ID = Number(env("CHAIN_ID", "31337"));
const RPC_URL = env("RPC_URL", "http://127.0.0.1:8545");
const ESCROW_ADDRESS = env("ESCROW_ADDRESS") as Address;
const TOKEN_ADDRESS = env("TOKEN_ADDRESS", TUSD8_ADDRESS) as Address;
const SELLER_ADDRESS = env("SELLER_ADDRESS") as Address;
const ARBITER_ADDRESS = env("ARBITER_ADDRESS") as Address;
const PRICE = BigInt(env("PRICE", "5000000")); // 5 tUSD8 (6 decimals)
const DELIVERY_WINDOW_SECS = Number(env("DELIVERY_WINDOW_SECS", "3600"));
const REVIEW_WINDOW_SECS = Number(env("REVIEW_WINDOW_SECS", "900"));
const PORT = Number(env("PORT", "8787"));

const relayer = privateKeyToAccount(env("RELAYER_KEY") as Hex);
const sellerAccount = privateKeyToAccount(env("SELLER_KEY") as Hex);
if (sellerAccount.address.toLowerCase() !== SELLER_ADDRESS.toLowerCase()) {
  throw new Error("SELLER_KEY does not match SELLER_ADDRESS");
}

const baseChain: Chain = CHAIN_ID === aevumTestnet.id ? aevumTestnet : CHAIN_ID === aevumFork.id ? aevumFork : localAnvil;
const chain: Chain = { ...baseChain, id: CHAIN_ID };

const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
const relayerClient = createWalletClient({ account: relayer, chain, transport: http(RPC_URL) });
const sellerClient = createWalletClient({ account: sellerAccount, chain, transport: http(RPC_URL) });

// ------------------------------------------------------------------ content

/** Deterministic premium resource: same id -> same bytes -> same proof hash. */
function reportContent(id: string): string {
  return JSON.stringify(
    {
      report: id,
      title: `Premium agent-market brief #${id}`,
      summary:
        "Verified demand signals for agent-to-agent services, escrow dispute statistics, and settlement latency benchmarks for the current epoch.",
      signals: [
        { metric: "escrow_cases_opened", value: 1284, deltaPct: 12.5 },
        { metric: "dispute_rate", value: 0.031, deltaPct: -8.2 },
        { metric: "median_settlement_secs", value: 42, deltaPct: -15.0 },
      ],
      license: "Single-buyer delivery via PayCourt escrow. Redistribution voids the delivery proof.",
    },
    null,
    2,
  );
}

function agreementHashFor(reportId: string): Hex {
  return keccak256(toBytes(`paycourt-report:${reportId}:v1`));
}

interface ServedCase {
  caseId: bigint;
  reportId: string;
  content: string;
  proofHash: Hex;
}

/** nonce -> served case, so a retried X-PAYMENT returns the same case instead of failing. */
const servedByNonce = new Map<string, ServedCase>();
/** caseId -> served record, for the judge's evidence check. */
const servedByCase = new Map<string, ServedCase>();

// ------------------------------------------------------------------ helpers

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body, null, 2));
}

function paymentRequired(reportId: string) {
  return {
    x402Version: 1,
    error: "payment required",
    accepts: [
      {
        scheme: "escrow-authorization",
        network: `qday-aevum-${CHAIN_ID}`,
        asset: TOKEN_ADDRESS,
        maxAmountRequired: PRICE.toString(),
        payTo: ESCROW_ADDRESS,
        resource: `/api/report/${reportId}`,
        description: "Premium report, delivered against a PayCourt escrow case (funds locked until delivery is confirmed).",
        extra: {
          seller: SELLER_ADDRESS,
          arbiter: ARBITER_ADDRESS,
          agreementHash: agreementHashFor(reportId),
          deliveryWindowSecs: DELIVERY_WINDOW_SECS,
          reviewWindowSecs: REVIEW_WINDOW_SECS,
          authorizationType: "ReceiveWithAuthorization",
          tokenName: "tUSD8",
          tokenVersion: "2",
        },
      },
    ],
  };
}

interface PaymentPayload {
  authorization: {
    from: Address;
    to: Address;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: Hex;
  };
  signature: Hex;
  case: {
    seller: Address;
    arbiter: Address;
    agreementHash: Hex;
    deliveryWindowSecs: number;
    reviewWindowSecs: number;
  };
}

// ------------------------------------------------------------------ payment

async function settleAndServe(reportId: string, payload: PaymentPayload): Promise<ServedCase> {
  const { authorization, signature, case: caseTerms } = payload;
  const nonceKey = authorization.nonce.toLowerCase();

  const existing = servedByNonce.get(nonceKey);
  if (existing) return existing; // idempotent retry

  // --- terms checks (fail fast, before touching the chain)
  if (authorization.to.toLowerCase() !== ESCROW_ADDRESS.toLowerCase()) {
    throw new HttpError(400, "authorization 'to' must be the EscrowCourt contract");
  }
  if (BigInt(authorization.value) !== PRICE) {
    throw new HttpError(400, `authorization value must equal the price (${PRICE})`);
  }
  if (
    caseTerms.seller.toLowerCase() !== SELLER_ADDRESS.toLowerCase() ||
    caseTerms.arbiter.toLowerCase() !== ARBITER_ADDRESS.toLowerCase() ||
    caseTerms.agreementHash.toLowerCase() !== agreementHashFor(reportId).toLowerCase()
  ) {
    throw new HttpError(400, "case terms do not match the 402 offer");
  }

  // --- signature check off-chain (the token re-checks on-chain)
  const message = {
    from: authorization.from,
    to: authorization.to,
    value: BigInt(authorization.value),
    validAfter: BigInt(authorization.validAfter),
    validBefore: BigInt(authorization.validBefore),
    nonce: authorization.nonce,
  };
  const ok = await verifyTypedData({
    address: authorization.from,
    domain: tusd8Domain(CHAIN_ID, TOKEN_ADDRESS),
    types: receiveWithAuthorizationTypes,
    primaryType: "ReceiveWithAuthorization",
    message,
    signature,
  });
  if (!ok) throw new HttpError(400, "invalid EIP-3009 signature");

  // --- settle: open the escrow case funded by the authorization
  const { v, r, s } = parseSignature(signature);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const hash = await relayerClient.writeContract({
    address: ESCROW_ADDRESS,
    abi: escrowCourtAbi,
    functionName: "openCaseWithAuthorization",
    args: [
      caseTerms.seller,
      caseTerms.arbiter,
      PRICE,
      caseTerms.agreementHash,
      now + BigInt(caseTerms.deliveryWindowSecs),
      caseTerms.reviewWindowSecs,
      {
        buyer: authorization.from,
        validAfter: message.validAfter,
        validBefore: message.validBefore,
        nonce: authorization.nonce,
        v: Number(v ?? 0n),
        r,
        s,
      },
    ],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new HttpError(502, "openCaseWithAuthorization reverted");
  const opened = parseEventLogs({ abi: escrowCourtAbi, logs: receipt.logs, eventName: "CaseOpened" });
  if (opened.length === 0) throw new HttpError(502, "CaseOpened event not found");
  const caseId = opened[0].args.caseId;

  // --- deliver: commit the proof hash on-chain, then serve the content
  const content = reportContent(reportId);
  const proofHash = keccak256(toBytes(content));
  const deliverHash = await sellerClient.writeContract({
    address: ESCROW_ADDRESS,
    abi: escrowCourtAbi,
    functionName: "markDelivered",
    args: [caseId, proofHash],
  });
  const deliverReceipt = await publicClient.waitForTransactionReceipt({ hash: deliverHash });
  if (deliverReceipt.status !== "success") throw new HttpError(502, "markDelivered reverted");

  const served: ServedCase = { caseId, reportId, content, proofHash };
  servedByNonce.set(nonceKey, served);
  servedByCase.set(caseId.toString(), served);
  return served;
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// ------------------------------------------------------------------ server

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, { ok: true, chainId: CHAIN_ID, escrow: ESCROW_ADDRESS, price: PRICE.toString() });
    }

    const reportMatch = url.pathname.match(/^\/api\/report\/([\w-]+)$/);
    if (req.method === "GET" && reportMatch) {
      const reportId = reportMatch[1];
      const header = req.headers["x-payment"];
      if (!header) return json(res, 402, paymentRequired(reportId));
      const payload = JSON.parse(Buffer.from(String(header), "base64").toString("utf8")) as PaymentPayload;
      const served = await settleAndServe(reportId, payload);
      res.writeHead(200, {
        "content-type": "application/json",
        "x-case-id": served.caseId.toString(),
        "x-delivery-proof": served.proofHash,
      });
      return res.end(served.content);
    }

    const caseMatch = url.pathname.match(/^\/api\/case\/(\d+)$/);
    if (req.method === "GET" && caseMatch) {
      const c = await publicClient.readContract({
        address: ESCROW_ADDRESS,
        abi: escrowCourtAbi,
        functionName: "getCase",
        args: [BigInt(caseMatch[1])],
      });
      return json(res, 200, {
        caseId: caseMatch[1],
        buyer: c.buyer,
        seller: c.seller,
        arbiter: c.arbiter,
        amount: c.amount.toString(),
        agreementHash: c.agreementHash,
        deliveryProofHash: c.deliveryProofHash,
        disputeReasonHash: c.disputeReasonHash,
        verdictReasonHash: c.verdictReasonHash,
        deliveryDeadline: c.deliveryDeadline.toString(),
        deliveredAt: c.deliveredAt.toString(),
        reviewWindowSecs: c.reviewWindowSecs,
        state: c.state,
      });
    }

    const proofMatch = url.pathname.match(/^\/api\/proof\/(\d+)$/);
    if (req.method === "GET" && proofMatch) {
      const served = servedByCase.get(proofMatch[1]);
      if (!served) return json(res, 404, { error: "no delivery recorded for this case" });
      return json(res, 200, { caseId: proofMatch[1], reportId: served.reportId, proofHash: served.proofHash });
    }

    return json(res, 404, { error: "not found" });
  } catch (e) {
    if (e instanceof HttpError) return json(res, e.status, { error: e.message });
    console.error(e);
    return json(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
}

createServer((req, res) => void handle(req, res)).listen(PORT, () => {
  console.log(`paycourt gateway on :${PORT} (chain ${CHAIN_ID}, escrow ${ESCROW_ADDRESS}, price ${PRICE})`);
});
