// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EscrowCourt} from "../src/EscrowCourt.sol";
import {MockUSD8} from "../src/mocks/MockUSD8.sol";
import {Signing} from "./Signing.sol";

contract EscrowCourtTest is Test {
    MockUSD8 token;
    EscrowCourt court;

    address buyer;
    uint256 buyerKey;
    address seller = makeAddr("seller");
    address judge = makeAddr("judge");
    address relayer = makeAddr("relayer");
    address stranger = makeAddr("stranger");

    uint256 constant AMOUNT = 5e6; // 5 tUSD8
    uint256 constant CAP = 100e6; // 100 tUSD8
    uint32 constant REVIEW = 1 days;
    bytes32 constant AGREEMENT = keccak256("service-agreement-v1");
    bytes32 constant PROOF = keccak256("delivery-proof");
    bytes32 constant REASON = keccak256("not-as-described");
    bytes32 constant VERDICT = keccak256("rubric-v1:facts");

    function setUp() public {
        (buyer, buyerKey) = makeAddrAndKey("buyer");
        token = new MockUSD8();
        court = new EscrowCourt(IERC20(address(token)), CAP);
        token.mint(buyer, 1_000e6);
        vm.prank(buyer);
        token.approve(address(court), type(uint256).max);
    }

    function _deadline() internal view returns (uint64) {
        return uint64(block.timestamp + 2 days);
    }

    function _open() internal returns (uint256 id) {
        vm.prank(buyer);
        id = court.openCase(seller, judge, AMOUNT, AGREEMENT, _deadline(), REVIEW);
    }

    function _openDelivered() internal returns (uint256 id) {
        id = _open();
        vm.prank(seller);
        court.markDelivered(id, PROOF);
    }

    // ------------------------------------------------------------ happy path

    function test_openLocksFunds() public {
        uint256 id = _open();
        assertEq(token.balanceOf(address(court)), AMOUNT);
        EscrowCourt.Case memory c = court.getCase(id);
        assertEq(c.buyer, buyer);
        assertEq(c.seller, seller);
        assertEq(c.arbiter, judge);
        assertEq(c.amount, AMOUNT);
        assertEq(uint8(c.state), uint8(EscrowCourt.State.Open));
    }

    function test_confirmReleasePaysSeller() public {
        uint256 id = _openDelivered();
        vm.prank(buyer);
        court.confirmRelease(id);
        assertEq(token.balanceOf(seller), AMOUNT);
        assertEq(token.balanceOf(address(court)), 0);
        assertEq(uint8(court.getCase(id).state), uint8(EscrowCourt.State.Released));
    }

    // --------------------------------------------------------------- dispute

    function test_disputeResolveRelease() public {
        uint256 id = _openDelivered();
        vm.prank(buyer);
        court.dispute(id, REASON);
        vm.prank(judge);
        court.resolve(id, true, VERDICT);
        assertEq(token.balanceOf(seller), AMOUNT);
        EscrowCourt.Case memory c = court.getCase(id);
        assertEq(c.verdictReasonHash, VERDICT);
        assertEq(uint8(c.state), uint8(EscrowCourt.State.Released));
    }

    function test_disputeResolveRefund() public {
        uint256 id = _openDelivered();
        uint256 before = token.balanceOf(buyer);
        vm.prank(buyer);
        court.dispute(id, REASON);
        vm.prank(judge);
        court.resolve(id, false, VERDICT);
        assertEq(token.balanceOf(buyer), before + AMOUNT);
        assertEq(uint8(court.getCase(id).state), uint8(EscrowCourt.State.Refunded));
    }

    function test_resolveByNonArbiterReverts() public {
        uint256 id = _openDelivered();
        vm.prank(buyer);
        court.dispute(id, REASON);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(EscrowCourt.NotArbiter.selector, id));
        court.resolve(id, true, VERDICT);
    }

    function test_disputeAfterWindowReverts() public {
        uint256 id = _openDelivered();
        vm.warp(block.timestamp + REVIEW + 1);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(EscrowCourt.TooLate.selector, id));
        court.dispute(id, REASON);
    }

    // -------------------------------------------------------------- timeouts

    function test_timeoutRefundWhenNoDelivery() public {
        uint256 id = _open();
        uint256 before = token.balanceOf(buyer);
        vm.warp(block.timestamp + 2 days + 1);
        vm.prank(buyer);
        court.claimTimeoutRefund(id);
        assertEq(token.balanceOf(buyer), before + AMOUNT);
        assertEq(uint8(court.getCase(id).state), uint8(EscrowCourt.State.Refunded));
    }

    function test_timeoutRefundTooEarlyReverts() public {
        uint256 id = _open();
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(EscrowCourt.TooEarly.selector, id));
        court.claimTimeoutRefund(id);
    }

    function test_autoReleaseAfterReviewWindow() public {
        uint256 id = _openDelivered();
        vm.warp(block.timestamp + REVIEW + 1);
        vm.prank(stranger); // anyone may trigger
        court.claimAutoRelease(id);
        assertEq(token.balanceOf(seller), AMOUNT);
    }

    function test_deliveryAfterDeadlineReverts() public {
        uint256 id = _open();
        vm.warp(block.timestamp + 2 days + 1);
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(EscrowCourt.TooLate.selector, id));
        court.markDelivered(id, PROOF);
    }

    // ---------------------------------------------------------------- guards

    function test_amountAboveCapReverts() public {
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(EscrowCourt.AmountAboveCap.selector, CAP + 1, CAP));
        court.openCase(seller, judge, CAP + 1, AGREEMENT, _deadline(), REVIEW);
    }

    function test_markDeliveredByNonSellerReverts() public {
        uint256 id = _open();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(EscrowCourt.NotSeller.selector, id));
        court.markDelivered(id, PROOF);
    }

    function test_doubleTransitionReverts() public {
        uint256 id = _openDelivered();
        vm.prank(buyer);
        court.confirmRelease(id);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(EscrowCourt.BadState.selector, id, EscrowCourt.State.Released));
        court.confirmRelease(id);
    }

    // ------------------------------------------------- EIP-3009 funded case

    function test_openWithAuthorization() public {
        bytes32 nonce = keccak256("auth-nonce-1");
        Signing.Auth memory a = Signing.Auth({
            from: buyer,
            to: address(court),
            value: AMOUNT,
            validAfter: 0,
            validBefore: block.timestamp + 1 hours,
            nonce: nonce
        });
        (uint8 v, bytes32 r, bytes32 s) = Signing.signReceive(vm, buyerKey, token.DOMAIN_SEPARATOR(), a);
        EscrowCourt.Authorization memory auth = EscrowCourt.Authorization({
            buyer: buyer, validAfter: a.validAfter, validBefore: a.validBefore, nonce: nonce, v: v, r: r, s: s
        });

        vm.prank(relayer); // buyer needs no gas and no approval
        uint256 id = court.openCaseWithAuthorization(seller, judge, AMOUNT, AGREEMENT, _deadline(), REVIEW, auth);

        assertEq(token.balanceOf(address(court)), AMOUNT);
        EscrowCourt.Case memory c = court.getCase(id);
        assertEq(c.buyer, buyer);
        assertEq(uint8(c.state), uint8(EscrowCourt.State.Open));

        // and the case completes normally
        vm.prank(seller);
        court.markDelivered(id, PROOF);
        vm.prank(buyer);
        court.confirmRelease(id);
        assertEq(token.balanceOf(seller), AMOUNT);
    }

    function test_openWithAuthorizationNonceReplayReverts() public {
        bytes32 nonce = keccak256("auth-nonce-replay");
        Signing.Auth memory a = Signing.Auth({
            from: buyer,
            to: address(court),
            value: AMOUNT,
            validAfter: 0,
            validBefore: block.timestamp + 1 hours,
            nonce: nonce
        });
        (uint8 v, bytes32 r, bytes32 s) = Signing.signReceive(vm, buyerKey, token.DOMAIN_SEPARATOR(), a);
        EscrowCourt.Authorization memory auth = EscrowCourt.Authorization({
            buyer: buyer, validAfter: a.validAfter, validBefore: a.validBefore, nonce: nonce, v: v, r: r, s: s
        });

        vm.prank(relayer);
        court.openCaseWithAuthorization(seller, judge, AMOUNT, AGREEMENT, _deadline(), REVIEW, auth);
        vm.prank(relayer);
        vm.expectRevert(); // token rejects the reused nonce
        court.openCaseWithAuthorization(seller, judge, AMOUNT, AGREEMENT, _deadline(), REVIEW, auth);
    }
}
