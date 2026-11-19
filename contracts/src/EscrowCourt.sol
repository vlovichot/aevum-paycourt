// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice EIP-3009 signed transfers, as implemented by tUSD8 on QDay Aevum.
interface IERC3009 {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

/// @title EscrowCourt
/// @notice Escrow + adjudication for agent-to-agent service payments in tUSD8.
///         A buyer locks payment for a named seller; the seller marks delivery with a
///         proof hash; the buyer releases, or disputes and lets the case's arbiter
///         (a judge agent) resolve RELEASE or REFUND. Deadlines are enforced on-chain:
///         no delivery by the deadline refunds the buyer, and an undisputed delivery
///         auto-releases after the review window.
/// @dev The contract never takes fees and has no admin withdrawal or upgrade path.
///      It holds only locked case funds and pays exactly the case amount to exactly
///      the buyer (refund) or the seller (release).
contract EscrowCourt is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum State {
        None,
        Open,
        Delivered,
        Disputed,
        Released,
        Refunded
    }

    struct Case {
        address buyer;
        address seller;
        address arbiter;
        uint256 amount;
        bytes32 agreementHash;
        bytes32 deliveryProofHash;
        bytes32 disputeReasonHash;
        bytes32 verdictReasonHash;
        uint64 deliveryDeadline;
        uint64 deliveredAt;
        uint32 reviewWindowSecs;
        State state;
    }

    IERC20 public immutable token;
    /// @notice Hard cap on any single case, set at deploy time. Bounds the blast
    ///         radius of any one payment (budget-cap control).
    uint256 public immutable maxCaseAmount;

    uint256 public caseCount;
    mapping(uint256 caseId => Case) private _cases;

    event CaseOpened(
        uint256 indexed caseId,
        address indexed buyer,
        address indexed seller,
        address arbiter,
        uint256 amount,
        bytes32 agreementHash,
        uint64 deliveryDeadline,
        uint32 reviewWindowSecs
    );
    event CaseFundedWithAuthorization(uint256 indexed caseId, bytes32 authorizationNonce);
    event CaseDelivered(uint256 indexed caseId, bytes32 deliveryProofHash, uint64 deliveredAt);
    event CaseDisputed(uint256 indexed caseId, bytes32 disputeReasonHash);
    event CaseReleased(uint256 indexed caseId, address indexed to, uint256 amount);
    event CaseRefunded(uint256 indexed caseId, address indexed to, uint256 amount);
    event CaseResolved(uint256 indexed caseId, bool releaseToSeller, bytes32 verdictReasonHash);

    error ZeroAddress();
    error ZeroAmount();
    error AmountAboveCap(uint256 amount, uint256 cap);
    error BadDeadline();
    error BadState(uint256 caseId, State state);
    error NotBuyer(uint256 caseId);
    error NotSeller(uint256 caseId);
    error NotArbiter(uint256 caseId);
    error TooEarly(uint256 caseId);
    error TooLate(uint256 caseId);

    constructor(IERC20 token_, uint256 maxCaseAmount_) {
        if (address(token_) == address(0)) revert ZeroAddress();
        if (maxCaseAmount_ == 0) revert ZeroAmount();
        token = token_;
        maxCaseAmount = maxCaseAmount_;
    }

    // ------------------------------------------------------------------ open

    /// @notice Open a case, pulling `amount` of token from the buyer (needs approval).
    function openCase(
        address seller,
        address arbiter,
        uint256 amount,
        bytes32 agreementHash,
        uint64 deliveryDeadline,
        uint32 reviewWindowSecs
    ) external nonReentrant returns (uint256 caseId) {
        caseId = _createCase(msg.sender, seller, arbiter, amount, agreementHash, deliveryDeadline, reviewWindowSecs);
        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Parameters of an EIP-3009 authorization signed by the buyer.
    struct Authorization {
        address buyer;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    /// @notice Open a case funded by an EIP-3009 authorization signed by the buyer.
    /// @dev `to` inside the signed authorization must be this contract and `value`
    ///      must equal `amount`; the token contract itself enforces nonce uniqueness
    ///      and the validity window. Anyone may submit (gateway, seller, relayer),
    ///      so the buyer needs no native gas token.
    function openCaseWithAuthorization(
        address seller,
        address arbiter,
        uint256 amount,
        bytes32 agreementHash,
        uint64 deliveryDeadline,
        uint32 reviewWindowSecs,
        Authorization calldata auth
    ) external nonReentrant returns (uint256 caseId) {
        caseId = _createCase(
            auth.buyer, seller, arbiter, amount, agreementHash, deliveryDeadline, reviewWindowSecs
        );
        IERC3009(address(token)).receiveWithAuthorization(
            auth.buyer, address(this), amount, auth.validAfter, auth.validBefore, auth.nonce, auth.v, auth.r, auth.s
        );
        emit CaseFundedWithAuthorization(caseId, auth.nonce);
    }

    function _createCase(
        address buyer,
        address seller,
        address arbiter,
        uint256 amount,
        bytes32 agreementHash,
        uint64 deliveryDeadline,
        uint32 reviewWindowSecs
    ) internal returns (uint256 caseId) {
        if (seller == address(0) || arbiter == address(0) || buyer == address(0)) revert ZeroAddress();
        if (seller == buyer) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > maxCaseAmount) revert AmountAboveCap(amount, maxCaseAmount);
        if (deliveryDeadline <= block.timestamp) revert BadDeadline();
        if (reviewWindowSecs == 0) revert BadDeadline();

        caseId = ++caseCount;
        Case storage c = _cases[caseId];
        c.buyer = buyer;
        c.seller = seller;
        c.arbiter = arbiter;
        c.amount = amount;
        c.agreementHash = agreementHash;
        c.deliveryDeadline = deliveryDeadline;
        c.reviewWindowSecs = reviewWindowSecs;
        c.state = State.Open;

        emit CaseOpened(caseId, buyer, seller, arbiter, amount, agreementHash, deliveryDeadline, reviewWindowSecs);
    }

    // -------------------------------------------------------------- delivery

    /// @notice Seller marks the service delivered, committing a proof hash on-chain.
    function markDelivered(uint256 caseId, bytes32 deliveryProofHash) external {
        Case storage c = _caseIn(caseId, State.Open);
        if (msg.sender != c.seller) revert NotSeller(caseId);
        if (block.timestamp > c.deliveryDeadline) revert TooLate(caseId);
        c.deliveryProofHash = deliveryProofHash;
        c.deliveredAt = uint64(block.timestamp);
        c.state = State.Delivered;
        emit CaseDelivered(caseId, deliveryProofHash, c.deliveredAt);
    }

    // --------------------------------------------------------------- release

    /// @notice Buyer confirms delivery; funds go to the seller.
    function confirmRelease(uint256 caseId) external nonReentrant {
        Case storage c = _caseIn(caseId, State.Delivered);
        if (msg.sender != c.buyer) revert NotBuyer(caseId);
        _release(caseId, c);
    }

    /// @notice After the review window passes undisputed, anyone may release to the seller.
    function claimAutoRelease(uint256 caseId) external nonReentrant {
        Case storage c = _caseIn(caseId, State.Delivered);
        if (block.timestamp < uint256(c.deliveredAt) + c.reviewWindowSecs) revert TooEarly(caseId);
        _release(caseId, c);
    }

    function _release(uint256 caseId, Case storage c) internal {
        c.state = State.Released;
        token.safeTransfer(c.seller, c.amount);
        emit CaseReleased(caseId, c.seller, c.amount);
    }

    // --------------------------------------------------------------- dispute

    /// @notice Buyer disputes within the review window, with a reason hash.
    function dispute(uint256 caseId, bytes32 disputeReasonHash) external {
        Case storage c = _caseIn(caseId, State.Delivered);
        if (msg.sender != c.buyer) revert NotBuyer(caseId);
        if (block.timestamp >= uint256(c.deliveredAt) + c.reviewWindowSecs) revert TooLate(caseId);
        c.disputeReasonHash = disputeReasonHash;
        c.state = State.Disputed;
        emit CaseDisputed(caseId, disputeReasonHash);
    }

    /// @notice The case's arbiter resolves a dispute. `verdictReasonHash` anchors the
    ///         judge's published reasoning so the verdict is auditable after the fact.
    function resolve(uint256 caseId, bool releaseToSeller, bytes32 verdictReasonHash) external nonReentrant {
        Case storage c = _caseIn(caseId, State.Disputed);
        if (msg.sender != c.arbiter) revert NotArbiter(caseId);
        c.verdictReasonHash = verdictReasonHash;
        emit CaseResolved(caseId, releaseToSeller, verdictReasonHash);
        if (releaseToSeller) {
            _release(caseId, c);
        } else {
            _refund(caseId, c);
        }
    }

    // ---------------------------------------------------------------- refund

    /// @notice If the seller never delivered by the deadline, the buyer reclaims funds.
    function claimTimeoutRefund(uint256 caseId) external nonReentrant {
        Case storage c = _caseIn(caseId, State.Open);
        if (msg.sender != c.buyer) revert NotBuyer(caseId);
        if (block.timestamp <= c.deliveryDeadline) revert TooEarly(caseId);
        _refund(caseId, c);
    }

    function _refund(uint256 caseId, Case storage c) internal {
        c.state = State.Refunded;
        token.safeTransfer(c.buyer, c.amount);
        emit CaseRefunded(caseId, c.buyer, c.amount);
    }

    // ----------------------------------------------------------------- views

    function getCase(uint256 caseId) external view returns (Case memory) {
        return _cases[caseId];
    }

    function _caseIn(uint256 caseId, State want) internal view returns (Case storage c) {
        c = _cases[caseId];
        if (c.state != want) revert BadState(caseId, c.state);
    }
}
