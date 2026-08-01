// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {
    Nox,
    ebool,
    euint16,
    euint256,
    externalEuint16,
    externalEuint256
} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";
import {NoxveilEpochState} from "./NoxveilEpochState.sol";
import {INoxveilAdapter} from "./interfaces/INoxveilAdapter.sol";
import {INoxveilVault} from "./interfaces/INoxveilVault.sol";
import {NoxveilMath} from "./libraries/NoxveilMath.sol";
import {NoxveilTypes} from "./libraries/NoxveilTypes.sol";

contract NoxveilStrategyEngine is NoxveilEpochState {
    uint8 public constant MAX_ACTIVE_STRATEGIES = 8;
    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint256 private constant WAD = 1e18;
    uint256 private constant USDC_TO_WAD = 1e12;
    uint256 private constant WETH_MIN_OUT_SCALE = 1e30;

    struct Strategy {
        address owner;
        bytes32 pairId;
        uint64 creationEpoch;
        uint64 clientNonce;
        uint8 slot;
        bool cancelled;
        euint16 direction;
        euint256 remaining;
        euint256 clip;
        euint256 limitPriceWad;
        euint256 slippageBps;
    }

    struct StrategyPublic {
        address owner;
        bytes32 pairId;
        uint64 creationEpoch;
        uint64 clientNonce;
        uint8 slot;
        bool cancelled;
    }

    struct StrategyHandleSet {
        bytes32 direction;
        bytes32 remaining;
        bytes32 clip;
        bytes32 limitPriceWad;
        bytes32 slippageBps;
    }

    struct ExternalStrategyInput {
        externalEuint16 direction;
        bytes directionProof;
        externalEuint256 budget;
        bytes budgetProof;
        externalEuint256 clip;
        bytes clipProof;
        externalEuint256 limitPriceWad;
        bytes limitPriceProof;
        externalEuint256 slippageBps;
        bytes slippageProof;
    }

    struct EpochPrivateHandleSet {
        bytes32 totalWeth;
        bytes32 totalUsdc;
        bytes32 totalRequestedQuote;
        bytes32 matchedQuote;
    }

    struct EpochStrategyHandleSet {
        bytes32 selectedWeth;
        bytes32 selectedUsdc;
        bytes32 reservationId;
    }

    struct SelectedFlow {
        euint256 wethAmount;
        euint256 usdcAmount;
        euint256 sellFloor;
        euint256 buyCeiling;
    }

    struct EpochComputation {
        euint256 totalWeth;
        euint256 totalUsdc;
        euint256 strictSellFloor;
        euint256 strictBuyCeiling;
    }

    struct EpochOutputs {
        euint256 totalRequestedQuote;
        euint256 matchedQuote;
        euint16 residualDirection;
        euint256 residualAmount;
        euint256 aggregateMinOut;
    }

    struct ResidualAmounts {
        ebool wethSide;
        euint256 wethAmount;
        euint256 usdcAmount;
    }

    struct CreditComputation {
        euint256[8] wethCredits;
        euint256[8] usdcCredits;
        euint256 wethOutput;
        euint256 usdcOutput;
        euint256 allocatedWeth;
        euint256 allocatedUsdc;
    }

    address public immutable vault;
    address public immutable adapter;
    uint64 public immutable epochDuration;
    bytes32 public immutable pairId;
    address public immutable auditorAdmin;
    address public auditor;
    uint8 public activeStrategyCount;

    bytes32[8] private strategyIdBySlot;
    mapping(bytes32 strategyId => Strategy strategy) private strategyById;
    mapping(bytes32 strategyId => bool used) public strategyIdUsed;
    mapping(address owner => mapping(uint64 nonce => bool used)) public clientNonceUsed;
    mapping(bytes32 handle => bool used) public handleUsed;
    mapping(uint64 epochNumber => bool used) public epochNumberUsed;
    mapping(bytes32 epochId => EpochPrivateHandleSet handles) private epochPrivateById;
    mapping(bytes32 epochId => mapping(bytes32 strategyId => EpochStrategyHandleSet handles))
        private epochStrategyById;
    mapping(bytes32 epochId => mapping(bytes32 strategyId => bool included))
        public epochStrategyIncluded;
    mapping(bytes32 epochId => bytes32[8] strategyIds) private epochStrategyIds;

    error InvalidEndpoint(address endpoint);
    error InvalidEpochDuration();
    error InvalidHandle();
    error HandleAlreadyUsed(bytes32 handle);
    error ClientNonceAlreadyUsed(address owner, uint64 nonce);
    error ActiveStrategyLimitReached();
    error UnknownStrategy(bytes32 strategyId);
    error OnlyStrategyOwner(bytes32 strategyId, address caller);
    error StrategyAlreadyCancelled(bytes32 strategyId);
    error InvalidSlot(uint8 slot);
    error EpochNumberAlreadyUsed(uint64 epochNumber);
    error NoActiveStrategies();
    error UnknownEpochStrategy(bytes32 epochId, bytes32 strategyId);
    error OnlyAuditorAdmin();
    error InvalidAdapterPair();

    event StrategyCreated(
        bytes32 indexed strategyId,
        address indexed owner,
        bytes32 indexed pairId,
        uint64 creationEpoch,
        uint64 clientNonce,
        uint8 slot
    );
    event StrategyBudgetIncreased(bytes32 indexed strategyId, address indexed owner);
    event StrategyCancelled(bytes32 indexed strategyId, address indexed owner);
    event AuditorUpdated(address indexed previousAuditor, address indexed newAuditor);

    constructor(address configuredVault, address configuredAdapter, uint64 configuredEpochDuration) {
        if (configuredVault.code.length == 0) revert InvalidEndpoint(configuredVault);
        if (configuredAdapter.code.length == 0) revert InvalidEndpoint(configuredAdapter);
        if (configuredEpochDuration == 0) revert InvalidEpochDuration();
        if (INoxveilAdapter(configuredAdapter).vault() != configuredVault) {
            revert InvalidEndpoint(configuredAdapter);
        }
        if (
            INoxveilAdapter(configuredAdapter).weth() != INoxveilVault(configuredVault).weth() ||
            INoxveilAdapter(configuredAdapter).usdc() != INoxveilVault(configuredVault).usdc()
        ) revert InvalidAdapterPair();
        NoxveilMath.validateFee(INoxveilAdapter(configuredAdapter).fee());
        vault = configuredVault;
        adapter = configuredAdapter;
        epochDuration = configuredEpochDuration;
        auditorAdmin = msg.sender;
        pairId = keccak256(
            abi.encode(
                INoxveilAdapter(configuredAdapter).weth(),
                INoxveilAdapter(configuredAdapter).usdc(),
                INoxveilAdapter(configuredAdapter).fee()
            )
        );
    }

    function currentEpoch() public view returns (uint64) {
        return uint64(block.timestamp / epochDuration);
    }

    function setAuditor(address nextAuditor) external {
        if (msg.sender != auditorAdmin) revert OnlyAuditorAdmin();
        address previous = auditor;
        auditor = nextAuditor;
        emit AuditorUpdated(previous, nextAuditor);
    }

    function lockCurrentEpoch(uint64 deadline) external returns (bytes32 epochId) {
        if (activeStrategyCount == 0) revert NoActiveStrategies();
        uint64 epochNumber = currentEpoch();
        if (epochNumberUsed[epochNumber]) revert EpochNumberAlreadyUsed(epochNumber);

        (uint256 twapPriceWad,) = INoxveilAdapter(adapter).consultTwap();
        if (twapPriceWad == 0) revert InvalidEpochLock();
        epochId = keccak256(abi.encode(block.chainid, address(this), epochNumber));
        epochNumberUsed[epochNumber] = true;
        _openEpoch(epochId, deadline, activeStrategyCount);

        euint256 zero = Nox.toEuint256(0);
        EpochComputation memory computation = EpochComputation({
            totalWeth: zero,
            totalUsdc: zero,
            strictSellFloor: zero,
            strictBuyCeiling: zero
        });

        for (uint8 slot; slot < MAX_ACTIVE_STRATEGIES; ++slot) {
            bytes32 strategyId = strategyIdBySlot[slot];
            if (strategyId == bytes32(0)) continue;
            epochStrategyIds[epochId][slot] = strategyId;
            epochStrategyIncluded[epochId][strategyId] = true;
            _evaluateAndReserve(epochId, strategyId, twapPriceWad, computation);
        }

        _lockComputedEpoch(epochId, twapPriceWad, computation);
    }

    function epochPrivateHandles(
        bytes32 epochId
    ) external view returns (EpochPrivateHandleSet memory) {
        if (!epochIdUsed[epochId]) revert InvalidEpochId();
        return epochPrivateById[epochId];
    }

    function epochStrategyHandles(
        bytes32 epochId,
        bytes32 strategyId
    ) external view returns (EpochStrategyHandleSet memory) {
        if (!epochStrategyIncluded[epochId][strategyId]) {
            revert UnknownEpochStrategy(epochId, strategyId);
        }
        return epochStrategyById[epochId][strategyId];
    }

    function finalizeAggregate(
        bytes32 epochId,
        bytes calldata directionProof,
        bytes calldata amountProof,
        bytes calldata minimumProof
    ) external {
        EpochPublic memory epoch = getEpoch(epochId);
        if (epoch.status != EpochStatus.Locked) {
            revert InvalidEpochStatus(epochId, epoch.status, EpochStatus.Locked);
        }
        bytes32 expectedCommitment = _recomputeActionCommitment(epochId, epoch);
        if (expectedCommitment != epoch.actionCommitment) {
            revert ActionCommitmentMismatch(expectedCommitment, epoch.actionCommitment);
        }

        uint16 direction = Nox.publicDecrypt(
            euint16.wrap(epoch.residualDirectionHandle),
            directionProof
        );
        uint256 residualAmount = Nox.publicDecrypt(
            euint256.wrap(epoch.residualAmountHandle),
            amountProof
        );
        uint256 amountOutMinimum = Nox.publicDecrypt(
            euint256.wrap(epoch.aggregateMinOutHandle),
            minimumProof
        );
        if (direction > 1) revert InvalidSettlementOutput(direction, 1);
        if (residualAmount == 0 && amountOutMinimum != 0) {
            revert InvalidSettlementOutput(residualAmount, amountOutMinimum);
        }
        _markEpochReady(
            epochId,
            expectedCommitment,
            uint8(direction),
            residualAmount,
            amountOutMinimum
        );
    }

    function settle(bytes32 epochId) external {
        EpochPublic memory epoch = getEpoch(epochId);
        bytes32 expectedCommitment = _recomputeActionCommitment(epochId, epoch);
        _beginSettlement(epochId, expectedCommitment);

        uint256 amountOut;
        if (epoch.residualAmount != 0) {
            amountOut = INoxveilVault(vault).executeResidual(
                epoch.residualDirection,
                epoch.residualAmount,
                epoch.amountOutMinimum
            );
        }
        _allocateAndCommitEpoch(epochId, epoch.residualDirection, epoch.residualAmount, amountOut);
        _completeSettlement(epochId, amountOut);
    }

    function cancelExpiredEpoch(bytes32 epochId) external {
        _cancelEpoch(epochId);
        for (uint8 slot; slot < MAX_ACTIVE_STRATEGIES; ++slot) {
            bytes32 strategyId = epochStrategyIds[epochId][slot];
            if (strategyId == bytes32(0)) continue;
            EpochStrategyHandleSet storage selection = epochStrategyById[epochId][strategyId];
            INoxveilVault(vault).releaseEpoch(selection.reservationId, strategyById[strategyId].owner);
        }
    }

    function createStrategy(
        ExternalStrategyInput calldata input,
        uint64 clientNonce
    ) external returns (bytes32 strategyId) {
        if (clientNonceUsed[msg.sender][clientNonce]) {
            revert ClientNonceAlreadyUsed(msg.sender, clientNonce);
        }
        uint8 slot = _allocateSlot();
        _claimHandle(externalEuint16.unwrap(input.direction));
        _claimHandle(externalEuint256.unwrap(input.budget));
        _claimHandle(externalEuint256.unwrap(input.clip));
        _claimHandle(externalEuint256.unwrap(input.limitPriceWad));
        _claimHandle(externalEuint256.unwrap(input.slippageBps));

        strategyId = keccak256(
            abi.encode(block.chainid, address(this), msg.sender, clientNonce)
        );
        if (strategyIdUsed[strategyId]) revert ClientNonceAlreadyUsed(msg.sender, clientNonce);

        Strategy storage strategy = strategyById[strategyId];
        strategy.owner = msg.sender;
        strategy.pairId = pairId;
        strategy.creationEpoch = currentEpoch();
        strategy.clientNonce = clientNonce;
        strategy.slot = slot;
        strategy.direction = _ingest(input.direction, input.directionProof, msg.sender);
        strategy.remaining = _ingest(input.budget, input.budgetProof, msg.sender);
        strategy.clip = _ingest(input.clip, input.clipProof, msg.sender);
        strategy.limitPriceWad = _ingest(
            input.limitPriceWad,
            input.limitPriceProof,
            msg.sender
        );
        strategy.slippageBps = _ingest(
            input.slippageBps,
            input.slippageProof,
            msg.sender
        );

        clientNonceUsed[msg.sender][clientNonce] = true;
        strategyIdUsed[strategyId] = true;
        strategyIdBySlot[slot] = strategyId;
        activeStrategyCount++;
        emit StrategyCreated(
            strategyId,
            msg.sender,
            pairId,
            strategy.creationEpoch,
            clientNonce,
            slot
        );
    }

    function increaseBudget(
        bytes32 strategyId,
        externalEuint256 amountHandle,
        bytes calldata amountProof
    ) external {
        Strategy storage strategy = _ownedStrategy(strategyId);
        _claimHandle(externalEuint256.unwrap(amountHandle));
        euint256 amount = Nox.fromExternal(amountHandle, amountProof);
        euint256 nextRemaining = Nox.add(strategy.remaining, amount);
        strategy.remaining = nextRemaining;
        _persist(nextRemaining, strategy.owner);
        emit StrategyBudgetIncreased(strategyId, strategy.owner);
    }

    function cancelStrategy(bytes32 strategyId) external {
        Strategy storage strategy = _ownedStrategy(strategyId);
        if (strategy.cancelled) revert StrategyAlreadyCancelled(strategyId);
        strategy.cancelled = true;
        strategyIdBySlot[strategy.slot] = bytes32(0);
        activeStrategyCount--;
        emit StrategyCancelled(strategyId, strategy.owner);
    }

    function getStrategyPublic(bytes32 strategyId) external view returns (StrategyPublic memory) {
        Strategy storage strategy = strategyById[strategyId];
        if (strategy.owner == address(0)) revert UnknownStrategy(strategyId);
        return StrategyPublic({
            owner: strategy.owner,
            pairId: strategy.pairId,
            creationEpoch: strategy.creationEpoch,
            clientNonce: strategy.clientNonce,
            slot: strategy.slot,
            cancelled: strategy.cancelled
        });
    }

    function strategyHandles(bytes32 strategyId) external view returns (StrategyHandleSet memory) {
        Strategy storage strategy = strategyById[strategyId];
        if (strategy.owner == address(0)) revert UnknownStrategy(strategyId);
        return StrategyHandleSet({
            direction: euint16.unwrap(strategy.direction),
            remaining: euint256.unwrap(strategy.remaining),
            clip: euint256.unwrap(strategy.clip),
            limitPriceWad: euint256.unwrap(strategy.limitPriceWad),
            slippageBps: euint256.unwrap(strategy.slippageBps)
        });
    }

    function activeStrategyAt(uint8 slot) external view returns (bytes32) {
        if (slot >= MAX_ACTIVE_STRATEGIES) revert InvalidSlot(slot);
        return strategyIdBySlot[slot];
    }

    function _evaluateAndReserve(
        bytes32 epochId,
        bytes32 strategyId,
        uint256 twapPriceWad,
        EpochComputation memory computation
    ) private {
        Strategy storage strategy = strategyById[strategyId];
        SelectedFlow memory flow = _selectFlow(strategy, twapPriceWad);
        bytes32 reservationId = keccak256(abi.encode(epochId, strategyId));

        _persist(flow.wethAmount, strategy.owner);
        _persist(flow.usdcAmount, strategy.owner);
        euint256 selectedNative = Nox.add(flow.wethAmount, flow.usdcAmount);
        Nox.allowTransient(strategy.direction, vault);
        Nox.allowTransient(selectedNative, vault);
        (bytes32 reservedWethHandle, bytes32 reservedUsdcHandle) = INoxveilVault(vault)
            .reserveForEpoch(
                reservationId,
                strategy.owner,
                euint16.unwrap(strategy.direction),
                euint256.unwrap(selectedNative)
            );

        euint256 reservedWeth = euint256.wrap(reservedWethHandle);
        euint256 reservedUsdc = euint256.wrap(reservedUsdcHandle);
        computation.totalWeth = Nox.add(computation.totalWeth, reservedWeth);
        computation.totalUsdc = Nox.add(computation.totalUsdc, reservedUsdc);
        computation.strictSellFloor = _updatedSellFloor(
            computation.strictSellFloor,
            flow.sellFloor,
            reservedWeth
        );
        computation.strictBuyCeiling = _updatedBuyCeiling(
            computation.strictBuyCeiling,
            flow.buyCeiling,
            reservedUsdc
        );

        epochStrategyById[epochId][strategyId] = EpochStrategyHandleSet({
            selectedWeth: reservedWethHandle,
            selectedUsdc: reservedUsdcHandle,
            reservationId: reservationId
        });
    }

    function _selectFlow(
        Strategy storage strategy,
        uint256 twapPriceWad
    ) private returns (SelectedFlow memory flow) {
        euint256 price = Nox.toEuint256(twapPriceWad);
        euint256 candidate = _min(strategy.remaining, strategy.clip);
        (flow.sellFloor, flow.buyCeiling) = _executionBounds(strategy, price);
        flow.wethAmount = _selectedWeth(strategy, candidate, price);
        flow.usdcAmount = _selectedUsdc(strategy, candidate, price);
    }

    function _selectedWeth(
        Strategy storage strategy,
        euint256 candidate,
        euint256 price
    ) private returns (euint256 selected) {
        euint256 zero = Nox.toEuint256(0);
        euint256 balance = euint256.wrap(
            INoxveilVault(vault).availableHandle(strategy.owner, INoxveilVault(vault).weth())
        );
        selected = Nox.select(Nox.le(candidate, balance), candidate, zero);
        selected = Nox.select(Nox.ge(price, strategy.limitPriceWad), selected, zero);
        selected = Nox.select(
            Nox.le(strategy.slippageBps, Nox.toEuint256(BPS_DENOMINATOR)),
            selected,
            zero
        );
        selected = Nox.select(
            Nox.eq(strategy.direction, Nox.toEuint16(0)),
            selected,
            zero
        );
    }

    function _selectedUsdc(
        Strategy storage strategy,
        euint256 candidate,
        euint256 price
    ) private returns (euint256 selected) {
        euint256 zero = Nox.toEuint256(0);
        euint256 balance = euint256.wrap(
            INoxveilVault(vault).availableHandle(strategy.owner, INoxveilVault(vault).usdc())
        );
        selected = Nox.select(Nox.le(candidate, balance), candidate, zero);
        selected = Nox.select(Nox.le(price, strategy.limitPriceWad), selected, zero);
        selected = Nox.select(
            Nox.le(strategy.slippageBps, Nox.toEuint256(BPS_DENOMINATOR)),
            selected,
            zero
        );
        selected = Nox.select(
            Nox.eq(strategy.direction, Nox.toEuint16(1)),
            selected,
            zero
        );
    }

    function _executionBounds(
        Strategy storage strategy,
        euint256 price
    ) private returns (euint256 sellFloor, euint256 buyCeiling) {
        euint256 basis = Nox.toEuint256(BPS_DENOMINATOR);
        (, euint256 sellFactor) = Nox.safeSub(basis, strategy.slippageBps);
        (, euint256 buyFactor) = Nox.safeAdd(basis, strategy.slippageBps);
        euint256 slippageFloor = Nox.div(Nox.mul(price, sellFactor), basis);
        euint256 slippageCeiling = Nox.div(Nox.mul(price, buyFactor), basis);
        sellFloor = Nox.select(
            Nox.ge(strategy.limitPriceWad, slippageFloor),
            strategy.limitPriceWad,
            slippageFloor
        );
        buyCeiling = Nox.select(
            Nox.le(strategy.limitPriceWad, slippageCeiling),
            strategy.limitPriceWad,
            slippageCeiling
        );
    }

    function _updatedSellFloor(
        euint256 current,
        euint256 candidate,
        euint256 selectedAmount
    ) private returns (euint256) {
        euint256 strictest = Nox.select(Nox.ge(candidate, current), candidate, current);
        return Nox.select(Nox.gt(selectedAmount, Nox.toEuint256(0)), strictest, current);
    }

    function _updatedBuyCeiling(
        euint256 current,
        euint256 candidate,
        euint256 selectedAmount
    ) private returns (euint256) {
        euint256 next = Nox.select(
            Nox.eq(current, Nox.toEuint256(0)),
            candidate,
            Nox.select(Nox.le(candidate, current), candidate, current)
        );
        return Nox.select(Nox.gt(selectedAmount, Nox.toEuint256(0)), next, current);
    }

    function _lockComputedEpoch(
        bytes32 epochId,
        uint256 twapPriceWad,
        EpochComputation memory computation
    ) private {
        EpochOutputs memory outputs = _computeEpochOutputs(twapPriceWad, computation);

        _storePrivateAggregates(
            epochId,
            computation.totalWeth,
            computation.totalUsdc,
            outputs.totalRequestedQuote,
            outputs.matchedQuote
        );
        Nox.allowThis(outputs.residualDirection);
        Nox.allowThis(outputs.residualAmount);
        Nox.allowThis(outputs.aggregateMinOut);
        Nox.allowPublicDecryption(outputs.residualDirection);
        Nox.allowPublicDecryption(outputs.residualAmount);
        Nox.allowPublicDecryption(outputs.aggregateMinOut);

        EpochPublic memory opened = getEpoch(epochId);
        bytes32 actionCommitment = NoxveilMath.actionCommitment(
            NoxveilTypes.ActionCommitmentInput({
                chainId: block.chainid,
                engine: address(this),
                vault: vault,
                adapter: adapter,
                epochId: epochId,
                epochNonce: opened.epochNonce,
                deadline: opened.deadline,
                weth: INoxveilVault(vault).weth(),
                usdc: INoxveilVault(vault).usdc(),
                uniswapRouter: INoxveilAdapter(adapter).router(),
                uniswapPool: INoxveilAdapter(adapter).pool(),
                fee: INoxveilAdapter(adapter).fee(),
                twapWindow: INoxveilAdapter(adapter).twapWindow(),
                twapPriceWad: twapPriceWad,
                residualDirectionHandle: euint16.unwrap(outputs.residualDirection),
                residualAmountHandle: euint256.unwrap(outputs.residualAmount),
                aggregateMinOutHandle: euint256.unwrap(outputs.aggregateMinOut)
            })
        );
        _lockEpoch(
            epochId,
            twapPriceWad,
            actionCommitment,
            euint16.unwrap(outputs.residualDirection),
            euint256.unwrap(outputs.residualAmount),
            euint256.unwrap(outputs.aggregateMinOut)
        );
    }

    function _computeEpochOutputs(
        uint256 twapPriceWad,
        EpochComputation memory computation
    ) private returns (EpochOutputs memory outputs) {
        euint256 price = Nox.toEuint256(twapPriceWad);
        euint256 wethQuote = Nox.div(
            Nox.mul(computation.totalWeth, price),
            Nox.toEuint256(WAD)
        );
        euint256 usdcQuote = Nox.mul(
            computation.totalUsdc,
            Nox.toEuint256(USDC_TO_WAD)
        );
        outputs.matchedQuote = _min(wethQuote, usdcQuote);
        outputs.totalRequestedQuote = Nox.add(wethQuote, usdcQuote);
        ResidualAmounts memory residual = _residualAmounts(wethQuote, usdcQuote, price);
        outputs.residualDirection = Nox.select(
            residual.wethSide,
            Nox.toEuint16(0),
            Nox.toEuint16(1)
        );
        outputs.residualAmount = Nox.select(
            residual.wethSide,
            residual.wethAmount,
            residual.usdcAmount
        );
        outputs.aggregateMinOut = _aggregateMinOut(
            residual.wethSide,
            residual.wethAmount,
            residual.usdcAmount,
            computation.strictSellFloor,
            computation.strictBuyCeiling
        );
    }

    function _residualAmounts(
        euint256 wethQuote,
        euint256 usdcQuote,
        euint256 price
    ) private returns (ResidualAmounts memory residual) {
        residual.wethSide = Nox.ge(wethQuote, usdcQuote);
        (, euint256 wethDeltaUnchecked) = Nox.safeSub(wethQuote, usdcQuote);
        (, euint256 usdcDeltaUnchecked) = Nox.safeSub(usdcQuote, wethQuote);
        euint256 zero = Nox.toEuint256(0);
        euint256 wethDelta = Nox.select(residual.wethSide, wethDeltaUnchecked, zero);
        euint256 usdcDelta = Nox.select(residual.wethSide, zero, usdcDeltaUnchecked);
        residual.wethAmount = Nox.div(
            Nox.mul(wethDelta, Nox.toEuint256(WAD)),
            price
        );
        residual.usdcAmount = Nox.div(usdcDelta, Nox.toEuint256(USDC_TO_WAD));
    }

    function _aggregateMinOut(
        ebool wethResidualSide,
        euint256 residualWeth,
        euint256 residualUsdc,
        euint256 strictSellFloor,
        euint256 strictBuyCeiling
    ) private returns (euint256) {
        euint256 sellMinimum = Nox.div(
            Nox.mul(residualWeth, strictSellFloor),
            Nox.toEuint256(WETH_MIN_OUT_SCALE)
        );
        euint256 safeBuyCeiling = Nox.select(
            Nox.eq(strictBuyCeiling, Nox.toEuint256(0)),
            Nox.toEuint256(1),
            strictBuyCeiling
        );
        euint256 buyMinimum = Nox.div(
            Nox.mul(residualUsdc, Nox.toEuint256(WETH_MIN_OUT_SCALE)),
            safeBuyCeiling
        );
        return Nox.select(wethResidualSide, sellMinimum, buyMinimum);
    }

    function _storePrivateAggregates(
        bytes32 epochId,
        euint256 totalWeth,
        euint256 totalUsdc,
        euint256 totalRequestedQuote,
        euint256 matchedQuote
    ) private {
        Nox.allowThis(totalWeth);
        Nox.allowThis(totalUsdc);
        Nox.allowThis(totalRequestedQuote);
        Nox.allowThis(matchedQuote);
        for (uint8 slot; slot < MAX_ACTIVE_STRATEGIES; ++slot) {
            bytes32 strategyId = epochStrategyIds[epochId][slot];
            if (strategyId == bytes32(0)) continue;
            address owner = strategyById[strategyId].owner;
            Nox.addViewer(totalRequestedQuote, owner);
            Nox.addViewer(matchedQuote, owner);
        }
        if (auditor != address(0)) {
            Nox.addViewer(totalRequestedQuote, auditor);
            Nox.addViewer(matchedQuote, auditor);
        }
        epochPrivateById[epochId] = EpochPrivateHandleSet({
            totalWeth: euint256.unwrap(totalWeth),
            totalUsdc: euint256.unwrap(totalUsdc),
            totalRequestedQuote: euint256.unwrap(totalRequestedQuote),
            matchedQuote: euint256.unwrap(matchedQuote)
        });
    }

    function _allocateAndCommitEpoch(
        bytes32 epochId,
        uint8 direction,
        uint256 residualAmount,
        uint256 amountOut
    ) private {
        EpochPrivateHandleSet storage privateHandles = epochPrivateById[epochId];
        euint256 totalWeth = euint256.wrap(privateHandles.totalWeth);
        euint256 totalUsdc = euint256.wrap(privateHandles.totalUsdc);
        CreditComputation memory credits;
        (credits.wethOutput, credits.usdcOutput) = _sideOutputs(
            direction,
            residualAmount,
            amountOut,
            totalWeth,
            totalUsdc
        );
        _buildFloorCredits(epochId, totalWeth, totalUsdc, credits);
        _assignWethDust(epochId, credits);
        _assignUsdcDust(epochId, credits);
        _commitCredits(epochId, credits);
    }

    function _sideOutputs(
        uint8 direction,
        uint256 residualAmount,
        uint256 amountOut,
        euint256 totalWeth,
        euint256 totalUsdc
    ) private returns (euint256 wethOutput, euint256 usdcOutput) {
        euint256 encryptedResidual = Nox.toEuint256(residualAmount);
        euint256 encryptedSwapOutput = Nox.toEuint256(amountOut);
        if (direction == 0) {
            wethOutput = Nox.sub(totalWeth, encryptedResidual);
            usdcOutput = Nox.add(totalUsdc, encryptedSwapOutput);
        } else {
            wethOutput = Nox.add(totalWeth, encryptedSwapOutput);
            usdcOutput = Nox.sub(totalUsdc, encryptedResidual);
        }
    }

    function _buildFloorCredits(
        bytes32 epochId,
        euint256 totalWeth,
        euint256 totalUsdc,
        CreditComputation memory credits
    ) private {
        euint256 safeWeth = _safeDenominator(totalWeth);
        euint256 safeUsdc = _safeDenominator(totalUsdc);
        credits.allocatedWeth = Nox.toEuint256(0);
        credits.allocatedUsdc = Nox.toEuint256(0);
        for (uint8 slot; slot < MAX_ACTIVE_STRATEGIES; ++slot) {
            bytes32 strategyId = epochStrategyIds[epochId][slot];
            if (strategyId == bytes32(0)) continue;
            EpochStrategyHandleSet storage selection = epochStrategyById[epochId][strategyId];
            euint256 selectedWeth = euint256.wrap(selection.selectedWeth);
            euint256 selectedUsdc = euint256.wrap(selection.selectedUsdc);
            credits.wethCredits[slot] = Nox.div(
                Nox.mul(credits.wethOutput, selectedUsdc),
                safeUsdc
            );
            credits.usdcCredits[slot] = Nox.div(
                Nox.mul(credits.usdcOutput, selectedWeth),
                safeWeth
            );
            credits.allocatedWeth = Nox.add(
                credits.allocatedWeth,
                credits.wethCredits[slot]
            );
            credits.allocatedUsdc = Nox.add(
                credits.allocatedUsdc,
                credits.usdcCredits[slot]
            );
        }
    }

    function _assignWethDust(bytes32 epochId, CreditComputation memory credits) private {
        euint256 dust = Nox.sub(credits.wethOutput, credits.allocatedWeth);
        euint256 assigned = Nox.toEuint256(0);
        for (uint8 cursor = MAX_ACTIVE_STRATEGIES; cursor > 0; --cursor) {
            uint8 slot = cursor - 1;
            bytes32 strategyId = epochStrategyIds[epochId][slot];
            if (strategyId == bytes32(0)) continue;
            euint256 selected = euint256.wrap(
                epochStrategyById[epochId][strategyId].selectedUsdc
            );
            (euint256 addition, euint256 nextAssigned) = _dustAssignment(
                selected,
                dust,
                assigned
            );
            credits.wethCredits[slot] = Nox.add(credits.wethCredits[slot], addition);
            assigned = nextAssigned;
        }
    }

    function _assignUsdcDust(bytes32 epochId, CreditComputation memory credits) private {
        euint256 dust = Nox.sub(credits.usdcOutput, credits.allocatedUsdc);
        euint256 assigned = Nox.toEuint256(0);
        for (uint8 cursor = MAX_ACTIVE_STRATEGIES; cursor > 0; --cursor) {
            uint8 slot = cursor - 1;
            bytes32 strategyId = epochStrategyIds[epochId][slot];
            if (strategyId == bytes32(0)) continue;
            euint256 selected = euint256.wrap(
                epochStrategyById[epochId][strategyId].selectedWeth
            );
            (euint256 addition, euint256 nextAssigned) = _dustAssignment(
                selected,
                dust,
                assigned
            );
            credits.usdcCredits[slot] = Nox.add(credits.usdcCredits[slot], addition);
            assigned = nextAssigned;
        }
    }

    function _dustAssignment(
        euint256 selected,
        euint256 dust,
        euint256 assigned
    ) private returns (euint256 addition, euint256 nextAssigned) {
        euint256 zero = Nox.toEuint256(0);
        euint256 one = Nox.toEuint256(1);
        euint256 selectedFlag = Nox.select(Nox.gt(selected, zero), one, zero);
        euint256 chooseFlag = Nox.select(Nox.eq(assigned, zero), selectedFlag, zero);
        addition = Nox.select(Nox.eq(chooseFlag, one), dust, zero);
        nextAssigned = Nox.add(assigned, chooseFlag);
    }

    function _commitCredits(bytes32 epochId, CreditComputation memory credits) private {
        for (uint8 slot; slot < MAX_ACTIVE_STRATEGIES; ++slot) {
            bytes32 strategyId = epochStrategyIds[epochId][slot];
            if (strategyId == bytes32(0)) continue;
            Strategy storage strategy = strategyById[strategyId];
            EpochStrategyHandleSet storage selection = epochStrategyById[epochId][strategyId];
            euint256 selectedNative = Nox.add(
                euint256.wrap(selection.selectedWeth),
                euint256.wrap(selection.selectedUsdc)
            );
            euint256 nextRemaining = Nox.sub(strategy.remaining, selectedNative);
            strategy.remaining = nextRemaining;
            _persist(nextRemaining, strategy.owner);
            _persist(credits.wethCredits[slot], strategy.owner);
            _persist(credits.usdcCredits[slot], strategy.owner);
            Nox.allowTransient(credits.wethCredits[slot], vault);
            Nox.allowTransient(credits.usdcCredits[slot], vault);
            INoxveilVault(vault).commitEpoch(
                selection.reservationId,
                strategy.owner,
                euint256.unwrap(credits.wethCredits[slot]),
                euint256.unwrap(credits.usdcCredits[slot])
            );
        }
    }

    function _safeDenominator(euint256 value) private returns (euint256) {
        euint256 zero = Nox.toEuint256(0);
        return Nox.select(Nox.eq(value, zero), Nox.toEuint256(1), value);
    }

    function _recomputeActionCommitment(
        bytes32 epochId,
        EpochPublic memory epoch
    ) private view returns (bytes32) {
        return NoxveilMath.actionCommitment(
            NoxveilTypes.ActionCommitmentInput({
                chainId: block.chainid,
                engine: address(this),
                vault: vault,
                adapter: adapter,
                epochId: epochId,
                epochNonce: epoch.epochNonce,
                deadline: epoch.deadline,
                weth: INoxveilVault(vault).weth(),
                usdc: INoxveilVault(vault).usdc(),
                uniswapRouter: INoxveilAdapter(adapter).router(),
                uniswapPool: INoxveilAdapter(adapter).pool(),
                fee: INoxveilAdapter(adapter).fee(),
                twapWindow: INoxveilAdapter(adapter).twapWindow(),
                twapPriceWad: epoch.twapPriceWad,
                residualDirectionHandle: epoch.residualDirectionHandle,
                residualAmountHandle: epoch.residualAmountHandle,
                aggregateMinOutHandle: epoch.aggregateMinOutHandle
            })
        );
    }

    function _min(euint256 a, euint256 b) private returns (euint256) {
        return Nox.select(Nox.le(a, b), a, b);
    }

    function _allocateSlot() private view returns (uint8) {
        if (activeStrategyCount >= MAX_ACTIVE_STRATEGIES) {
            revert ActiveStrategyLimitReached();
        }
        for (uint8 slot; slot < MAX_ACTIVE_STRATEGIES; ++slot) {
            if (strategyIdBySlot[slot] == bytes32(0)) return slot;
        }
        revert ActiveStrategyLimitReached();
    }

    function _claimHandle(bytes32 handle) private {
        if (handle == bytes32(0)) revert InvalidHandle();
        if (handleUsed[handle]) revert HandleAlreadyUsed(handle);
        handleUsed[handle] = true;
    }

    function _ownedStrategy(bytes32 strategyId) private view returns (Strategy storage strategy) {
        strategy = strategyById[strategyId];
        if (strategy.owner == address(0)) revert UnknownStrategy(strategyId);
        if (strategy.owner != msg.sender) revert OnlyStrategyOwner(strategyId, msg.sender);
    }

    function _ingest(
        externalEuint16 handle,
        bytes calldata proof,
        address owner
    ) private returns (euint16 value) {
        value = Nox.fromExternal(handle, proof);
        _persist(value, owner);
    }

    function _ingest(
        externalEuint256 handle,
        bytes calldata proof,
        address owner
    ) private returns (euint256 value) {
        value = Nox.fromExternal(handle, proof);
        _persist(value, owner);
    }

    function _persist(euint16 value, address owner) private {
        Nox.allowThis(value);
        Nox.allow(value, owner);
    }

    function _persist(euint256 value, address owner) private {
        Nox.allowThis(value);
        Nox.allow(value, owner);
    }
}
