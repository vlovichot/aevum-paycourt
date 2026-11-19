// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EscrowCourt} from "../src/EscrowCourt.sol";
import {MockUSD8} from "../src/mocks/MockUSD8.sol";

/// @notice Deploys EscrowCourt.
///   - Aevum testnet and `make fork`: uses the real tUSD8.
///   - Plain anvil (chain 31337) only: deploys MockUSD8 first and mints 1,000
///     to the deployer and, if BUYER is set, 1,000 to the buyer (local e2e).
///   MAX_CASE (optional env) caps a single case; default 100 tUSD8.
contract DeployEscrow is Script {
    address constant AEVUM_TUSD8 = 0x456569838f1d43009A91ebA4263147Afd7233483;
    uint256 constant ANVIL_CHAIN = 31337;
    uint256 constant DEFAULT_MAX_CASE = 100e6; // 100 tUSD8

    function run() external returns (EscrowCourt court, address token) {
        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();

        if (AEVUM_TUSD8.code.length > 0) {
            token = AEVUM_TUSD8;
        } else {
            require(block.chainid == ANVIL_CHAIN, "tUSD8 not found on this chain. Check the RPC (Aevum testnet is 44005).");
            MockUSD8 mock = new MockUSD8();
            mock.mint(deployer, 1_000e6);
            address buyer = vm.envOr("BUYER", address(0));
            if (buyer != address(0)) mock.mint(buyer, 1_000e6);
            token = address(mock);
        }

        uint256 maxCase = vm.envOr("MAX_CASE", DEFAULT_MAX_CASE);
        court = new EscrowCourt(IERC20(token), maxCase);
        vm.stopBroadcast();

        console.log("chainId    ", block.chainid);
        console.log("token      ", token);
        console.log("maxCase    ", maxCase);
        console.log("EscrowCourt", address(court));
    }
}
