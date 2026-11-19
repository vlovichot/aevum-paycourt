"use client";

import { useState } from "react";
import { useAccount, useConfig, useReadContract } from "wagmi";
import { readContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { formatUnits, isAddress, keccak256, parseUnits, toHex, type Address, type Hex } from "viem";
import { CaseStateName, erc20Abi, escrowCourtAbi } from "@aevum-kit/aevum";
import { useNetwork } from "@/lib/network";
import { explain } from "@/lib/errors";

const DECIMALS = 6;
const ZERO_HASH: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000";

const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");
const fmtTime = (secs: bigint) =>
  secs === 0n ? "—" : new Date(Number(secs) * 1000).toLocaleString();
const hashOrText = (v: string): Hex =>
  /^0x[0-9a-fA-F]{64}$/.test(v.trim()) ? (v.trim() as Hex) : keccak256(toHex(v));

type CaseData = {
  buyer: Address;
  seller: Address;
  arbiter: Address;
  amount: bigint;
  agreementHash: Hex;
  deliveryProofHash: Hex;
  disputeReasonHash: Hex;
  verdictReasonHash: Hex;
  deliveryDeadline: bigint;
  deliveredAt: bigint;
  reviewWindowSecs: number;
  state: number;
};

function ActionButton({
  label,
  onRun,
  disabled,
}: {
  label: string;
  onRun: () => Promise<string>;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button
        className="btn"
        disabled={busy || disabled}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            setMsg(await onRun());
          } catch (e) {
            setMsg(explain(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Working…" : label}
      </button>
      {msg ? <span className="fine">{msg}</span> : null}
    </span>
  );
}

function CaseCard({ escrow, id, account }: { escrow: Address; id: bigint; account?: Address }) {
  const config = useConfig();
  const { net } = useNetwork();
  const [proofText, setProofText] = useState("");
  const [reasonText, setReasonText] = useState("");
  const { data, refetch } = useReadContract({
    address: escrow,
    abi: escrowCourtAbi,
    functionName: "getCase",
    args: [id],
    chainId: net.chain.id,
    query: { refetchInterval: 20_000 },
  });
  if (!data) return null;
  const c = data as unknown as CaseData;
  const me = account?.toLowerCase();
  const isBuyer = me === c.buyer.toLowerCase();
  const isSeller = me === c.seller.toLowerCase();
  const isArbiter = me === c.arbiter.toLowerCase();
  const now = BigInt(Math.floor(Date.now() / 1000));
  const reviewEnds = c.deliveredAt + BigInt(c.reviewWindowSecs);

  const run = (functionName: string, args: unknown[]) => async () => {
    const hash = await writeContract(config, {
      address: escrow,
      abi: escrowCourtAbi,
      functionName: functionName as never,
      args: args as never,
      chainId: net.chain.id,
    });
    await waitForTransactionReceipt(config, { hash, chainId: net.chain.id });
    await refetch();
    return `Done: ${hash.slice(0, 10)}…`;
  };

  return (
    <section className="card stack" aria-label={`Case ${id}`}>
      <div className="check-top" style={{ alignItems: "baseline" }}>
        <strong>Case #{id.toString()}</strong>
        <span className="pill">{CaseStateName[c.state] ?? c.state}</span>
        <span className="num">{formatUnits(c.amount, DECIMALS)} tUSD8</span>
      </div>
      <div className="lines">
        <div className="line"><span>Buyer</span><span className="mono">{short(c.buyer)}{isBuyer ? " (you)" : ""}</span></div>
        <div className="line"><span>Seller</span><span className="mono">{short(c.seller)}{isSeller ? " (you)" : ""}</span></div>
        <div className="line"><span>Arbiter</span><span className="mono">{short(c.arbiter)}{isArbiter ? " (you)" : ""}</span></div>
        <div className="line"><span>Delivery deadline</span><span>{fmtTime(c.deliveryDeadline)}</span></div>
        {c.state >= 2 ? <div className="line"><span>Delivered at</span><span>{fmtTime(c.deliveredAt)}</span></div> : null}
        {c.state === 2 ? <div className="line"><span>Review ends</span><span>{fmtTime(reviewEnds)}</span></div> : null}
        {c.deliveryProofHash !== ZERO_HASH ? (
          <div className="line"><span>Delivery proof</span><span className="mono">{short(c.deliveryProofHash)}</span></div>
        ) : null}
        {c.verdictReasonHash !== ZERO_HASH ? (
          <div className="line"><span>Verdict reason</span><span className="mono">{short(c.verdictReasonHash)}</span></div>
        ) : null}
      </div>

      {c.state === 1 && isSeller ? (
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input
            value={proofText}
            onChange={(e) => setProofText(e.target.value)}
            placeholder="Delivery proof (text or 0x hash)"
            style={{ flex: "1 1 220px" }}
          />
          <ActionButton
            label="Mark delivered"
            disabled={!proofText.trim()}
            onRun={run("markDelivered", [id, hashOrText(proofText || `delivery-${id}`)])}
          />
        </div>
      ) : null}

      {c.state === 1 && isBuyer && now > c.deliveryDeadline ? (
        <ActionButton label="Claim timeout refund" onRun={run("claimTimeoutRefund", [id])} />
      ) : null}

      {c.state === 2 && isBuyer ? (
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <ActionButton label="Confirm release" onRun={run("confirmRelease", [id])} />
          <input
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
            placeholder="Dispute reason"
            style={{ flex: "1 1 200px" }}
          />
          <ActionButton
            label="Dispute"
            disabled={!reasonText.trim()}
            onRun={run("dispute", [id, hashOrText(reasonText)])}
          />
        </div>
      ) : null}

      {c.state === 2 && now > reviewEnds ? (
        <ActionButton label="Finalize auto-release" onRun={run("claimAutoRelease", [id])} />
      ) : null}

      {c.state === 3 && isArbiter ? (
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
            placeholder="Verdict reason (rubric reference)"
            style={{ flex: "1 1 200px" }}
          />
          <ActionButton
            label="Resolve: release to seller"
            onRun={run("resolve", [id, true, hashOrText(reasonText || "paycourt-rubric-v1")])}
          />
          <ActionButton
            label="Resolve: refund buyer"
            onRun={run("resolve", [id, false, hashOrText(reasonText || "paycourt-rubric-v1")])}
          />
        </div>
      ) : null}
    </section>
  );
}

function OpenCaseForm({ escrow, token, onOpened }: { escrow: Address; token: Address; onOpened: () => void }) {
  const config = useConfig();
  const { net } = useNetwork();
  const [seller, setSeller] = useState("");
  const [arbiter, setArbiter] = useState("");
  const [amount, setAmount] = useState("2");
  const [agreement, setAgreement] = useState("Market-data report");
  const [deliveryHours, setDeliveryHours] = useState("24");
  const [reviewMinutes, setReviewMinutes] = useState("60");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const valid =
    isAddress(seller) && isAddress(arbiter) && Number(amount) > 0 && Number(deliveryHours) > 0 && Number(reviewMinutes) > 0;

  const open = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const value = parseUnits(amount, DECIMALS);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + Number(deliveryHours) * 3600);
      const reviewSecs = Math.floor(Number(reviewMinutes) * 60);
      setStatus("Step 1/2: approving tUSD8…");
      const approveHash = await writeContract(config, {
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [escrow, value],
        chainId: net.chain.id,
      });
      await waitForTransactionReceipt(config, { hash: approveHash, chainId: net.chain.id });
      setStatus("Step 2/2: opening the case…");
      const hash = await writeContract(config, {
        address: escrow,
        abi: escrowCourtAbi,
        functionName: "openCase",
        args: [seller as Address, arbiter as Address, value, hashOrText(agreement), deadline, reviewSecs],
        chainId: net.chain.id,
      });
      await waitForTransactionReceipt(config, { hash, chainId: net.chain.id });
      const count = await readContract(config, {
        address: escrow,
        abi: escrowCourtAbi,
        functionName: "caseCount",
        chainId: net.chain.id,
      });
      setStatus(`Case #${count.toString()} opened. Funds are locked in EscrowCourt.`);
      onOpened();
    } catch (e) {
      setStatus(explain(e));
    } finally {
      setBusy(false);
    }
  };

  const field = (
    label: string,
    value: string,
    set: (v: string) => void,
    placeholder: string,
    flex = "1 1 200px",
  ) => (
    <label style={{ flex, display: "flex", flexDirection: "column", gap: 4 }}>
      <span className="fine">{label}</span>
      <input value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder} />
    </label>
  );

  return (
    <section className="card stack" aria-label="Open a case">
      <div className="check-top"><strong>Open a case</strong><span className="pill">buyer</span></div>
      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        {field("Seller address", seller, setSeller, "0x…")}
        {field("Arbiter address", arbiter, setArbiter, "0x…")}
      </div>
      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        {field("Amount (tUSD8)", amount, setAmount, "2", "1 1 120px")}
        {field("Agreement (hashed)", agreement, setAgreement, "What is being bought", "1 1 200px")}
        {field("Delivery window (hours)", deliveryHours, setDeliveryHours, "24", "1 1 120px")}
        {field("Review window (minutes)", reviewMinutes, setReviewMinutes, "60", "1 1 120px")}
      </div>
      <div className="row" style={{ gap: 8, alignItems: "center" }}>
        <button className="btn" disabled={!valid || busy} onClick={open}>
          {busy ? "Working…" : "Approve + open case"}
        </button>
        {status ? <span className="fine">{status}</span> : null}
      </div>
    </section>
  );
}

export default function PayCourtPage() {
  const { net } = useNetwork();
  const { address: account, isConnected } = useAccount();
  const escrow = net.escrow;
  const [refreshKey, setRefreshKey] = useState(0);

  const { data: token } = useReadContract({
    address: escrow,
    abi: escrowCourtAbi,
    functionName: "token",
    chainId: net.chain.id,
    query: { enabled: !!escrow },
  });
  const { data: caseCount } = useReadContract({
    address: escrow,
    abi: escrowCourtAbi,
    functionName: "caseCount",
    chainId: net.chain.id,
    query: { enabled: !!escrow, refetchInterval: 20_000 },
  });

  const explorer = net.chain.blockExplorers?.default.url;
  const count = caseCount ?? 0n;
  const ids = Array.from({ length: Number(count > 25n ? 25n : count) }, (_, i) => count - BigInt(i));

  return (
    <main className="shell">
      <div className="page-head">
        <div>
          <p className="eyebrow">PayCourt · EscrowCourt</p>
          <h1>Escrow + adjudication for agent payments</h1>
          <p className="lede">
            Payment locks in the contract, not in the seller&apos;s wallet. Delivery releases it,
            silence refunds it, and a named arbiter settles disputes — every step on-chain.
          </p>
        </div>
      </div>

      {!escrow ? (
        <p className="notice">EscrowCourt is not deployed on this network yet. Switch to Aevum testnet.</p>
      ) : (
        <div className="stack" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <p className="fine">
            EscrowCourt:{" "}
            {explorer ? (
              <a href={`${explorer}/address/${escrow}`} target="_blank" rel="noreferrer" className="mono">
                {escrow}
              </a>
            ) : (
              <span className="mono">{escrow}</span>
            )}{" "}
            · {count.toString()} case{count === 1n ? "" : "s"}
            {!isConnected ? " · connect a wallet to act" : ""}
          </p>

          {token ? (
            <OpenCaseForm
              key={refreshKey}
              escrow={escrow}
              token={token as Address}
              onOpened={() => setRefreshKey((k) => k + 1)}
            />
          ) : null}

          {ids.length === 0 ? (
            <p className="empty">No cases yet. Open the first one above.</p>
          ) : (
            ids.map((id) => <CaseCard key={`${refreshKey}-${id}`} escrow={escrow} id={id} account={account} />)
          )}
        </div>
      )}
    </main>
  );
}
