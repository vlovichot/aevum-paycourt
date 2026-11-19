/**
 * Buyer agent for the PayCourt gateway demo:
 *   1. Requests a premium report, gets a 402 with escrow payment terms.
 *   2. Signs an EIP-3009 authorization (off-chain, free, no gas needed) and
 *      retries with an X-PAYMENT header. The gateway settles it into an
 *      escrow case and delivers the report with its proof hash on-chain.
 *   3. Optionally settles the case: --confirm releases the funds to the
 *      seller; --dispute hands it to the judge agent.
 *
 *   GATEWAY_URL=http://127.0.0.1:8787 BUYER_KEY=0x... \
 *     pnpm --filter examples buy-report demo-1 [--confirm | --dispute]
 */
import { createWalletClient, http, keccak256, toBytes, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { authorizationWindow, checkoutTypedData, escrowCourtAbi } from "@aevum-kit/aevum";
import { connect, requiredKey } from "./env";

const gateway = (process.env.GATEWAY_URL?.trim() || "http://127.0.0.1:8787").replace(/\/$/, "");
const reportId = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "demo-1";
const buyer = privateKeyToAccount(requiredKey("BUYER_KEY"));
const { client, chain, rpcUrl } = await connect();
const buyerWallet = createWalletClient({ account: buyer, chain, transport: http(rpcUrl) });

// 1. Ask for the resource; expect a 402 with terms.
const first = await fetch(`${gateway}/api/report/${reportId}`);
if (first.status !== 402) {
  console.error(`expected 402, got ${first.status}: ${await first.text()}`);
  process.exit(1);
}
const offer = (await first.json()) as {
  accepts: Array<{
    payTo: Address;
    asset: Address;
    maxAmountRequired: string;
    extra: {
      seller: Address;
      arbiter: Address;
      agreementHash: Hex;
      deliveryWindowSecs: number;
      reviewWindowSecs: number;
    };
  }>;
};
const terms = offer.accepts[0];
console.log(`402 received: ${terms.maxAmountRequired} base units of ${terms.asset}, escrow ${terms.payTo}`);

// 2. Sign the authorization (to = escrow, so funds land locked in the case).
const nonce = keccak256(toHex(`paycourt-${buyer.address}-${Date.now()}-${Math.random()}`));
const { validAfter, validBefore } = authorizationWindow(600);
const value = BigInt(terms.maxAmountRequired);
const signature = await buyer.signTypedData(
  checkoutTypedData(chain.id, terms.asset, { from: buyer.address, to: terms.payTo, value, validAfter, validBefore, nonce }),
);
const payload = {
  authorization: {
    from: buyer.address,
    to: terms.payTo,
    value: value.toString(),
    validAfter: validAfter.toString(),
    validBefore: validBefore.toString(),
    nonce,
  },
  signature,
  case: {
    seller: terms.extra.seller,
    arbiter: terms.extra.arbiter,
    agreementHash: terms.extra.agreementHash,
    deliveryWindowSecs: terms.extra.deliveryWindowSecs,
    reviewWindowSecs: terms.extra.reviewWindowSecs,
  },
};

// 3. Retry with payment; the gateway settles on-chain and serves the report.
const paid = await fetch(`${gateway}/api/report/${reportId}`, {
  headers: { "x-payment": Buffer.from(JSON.stringify(payload)).toString("base64") },
});
if (!paid.ok) {
  console.error(`payment failed (${paid.status}): ${await paid.text()}`);
  process.exit(1);
}
const caseId = BigInt(paid.headers.get("x-case-id") ?? "0");
const proof = paid.headers.get("x-delivery-proof");
console.log(`report delivered; escrow case ${caseId}, delivery proof ${proof}`);
console.log("----- report -----");
console.log(await paid.text());
console.log("------------------");

// 4. Optional settlement.
if (process.argv.includes("--confirm")) {
  const hash = await buyerWallet.writeContract({
    address: terms.payTo,
    abi: escrowCourtAbi,
    functionName: "confirmRelease",
    args: [caseId],
  });
  await client.waitForTransactionReceipt({ hash });
  console.log(`confirmed release for case ${caseId} (tx ${hash})`);
} else if (process.argv.includes("--dispute")) {
  const hash = await buyerWallet.writeContract({
    address: terms.payTo,
    abi: escrowCourtAbi,
    functionName: "dispute",
    args: [caseId, keccak256(toBytes("buyer-dispute:content-not-as-agreed"))],
  });
  await client.waitForTransactionReceipt({ hash });
  console.log(`disputed case ${caseId} (tx ${hash}); the judge agent will resolve it`);
} else {
  console.log(`case ${caseId} left in Delivered state (re-run with --confirm or --dispute)`);
}
