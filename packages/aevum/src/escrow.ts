import { parseAbi } from "viem";

/**
 * PayCourt EscrowCourt ABI (hand-maintained against contracts/src/EscrowCourt.sol).
 * The Authorization struct is passed as a tuple; getCase returns the Case tuple.
 */
export const escrowCourtAbi = parseAbi([
  "function token() view returns (address)",
  "function maxCaseAmount() view returns (uint256)",
  "function caseCount() view returns (uint256)",
  "function openCase(address seller, address arbiter, uint256 amount, bytes32 agreementHash, uint64 deliveryDeadline, uint32 reviewWindowSecs) returns (uint256 caseId)",
  "function openCaseWithAuthorization(address seller, address arbiter, uint256 amount, bytes32 agreementHash, uint64 deliveryDeadline, uint32 reviewWindowSecs, (address buyer, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) auth) returns (uint256 caseId)",
  "function markDelivered(uint256 caseId, bytes32 deliveryProofHash)",
  "function confirmRelease(uint256 caseId)",
  "function claimAutoRelease(uint256 caseId)",
  "function dispute(uint256 caseId, bytes32 disputeReasonHash)",
  "function resolve(uint256 caseId, bool releaseToSeller, bytes32 verdictReasonHash)",
  "function claimTimeoutRefund(uint256 caseId)",
  "function getCase(uint256 caseId) view returns ((address buyer, address seller, address arbiter, uint256 amount, bytes32 agreementHash, bytes32 deliveryProofHash, bytes32 disputeReasonHash, bytes32 verdictReasonHash, uint64 deliveryDeadline, uint64 deliveredAt, uint32 reviewWindowSecs, uint8 state) case_)",
  "event CaseOpened(uint256 indexed caseId, address indexed buyer, address indexed seller, address arbiter, uint256 amount, bytes32 agreementHash, uint64 deliveryDeadline, uint32 reviewWindowSecs)",
  "event CaseFundedWithAuthorization(uint256 indexed caseId, bytes32 authorizationNonce)",
  "event CaseDelivered(uint256 indexed caseId, bytes32 deliveryProofHash, uint64 deliveredAt)",
  "event CaseDisputed(uint256 indexed caseId, bytes32 disputeReasonHash)",
  "event CaseReleased(uint256 indexed caseId, address indexed to, uint256 amount)",
  "event CaseRefunded(uint256 indexed caseId, address indexed to, uint256 amount)",
  "event CaseResolved(uint256 indexed caseId, bool releaseToSeller, bytes32 verdictReasonHash)",
]);

/** EscrowCourt case states, mirroring the Solidity enum. */
export const CaseState = {
  None: 0,
  Open: 1,
  Delivered: 2,
  Disputed: 3,
  Released: 4,
  Refunded: 5,
} as const;

export const CaseStateName = ["None", "Open", "Delivered", "Disputed", "Released", "Refunded"] as const;
