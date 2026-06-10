# Festival System Prototype — Smart Contracts

Solidity contracts for the Festival prototype, targeting any **pallet-revive (EVM)** parachain on Polkadot. Non-transferable tickets, attendance POAPs, role-based access control, and composable sessions.

The contracts are chain-agnostic: the set of chains the front end actually connects to (and the deployed addresses per chain) lives in the network registry at `packages/shared/host/networks.ts`, not here. The table below is the default dev testnet.

## Directory Structure

```
src/
├── protocols/
│   ├── nontransferable/
│   │   └── NonTransferableERC721.sol   # Abstract — non-transferable ERC-721 base
│   ├── poap/
│   │   ├── IAttendancePOAP.sol         # Interface — factory-authorized POAP minting protocol
│   │   └── AttendancePOAP.sol          # Soulbound POAP collection (shared across festivals)
│   └── multicall/
│       └── Multicall3.sol              # Canonical Multicall3 — batched on-chain reads
│
├── apps/events/
│   ├── Festival.sol                    # Main festival contract — registration, check-in, roles, sessions
│   └── FestivalSession.sol             # Per-session — created by Festival, independent registration + POAP
│
└── mocks/                              # Test-only helpers (EtherSink, MockCallee)

test/
├── protocols/
│   ├── NonTransferableERC721.t.sol
│   ├── AttendancePOAP.t.sol
│   └── Multicall3.t.sol
├── apps/events/
│   ├── Festival.t.sol
│   └── FestivalSession.t.sol
└── integration/
    └── FestivalIntegration.t.sol

script/
└── Deploy.s.sol                        # Festival deployment (Foundry)
```

## Architecture

```
Deployer EOA
  ├── deploys: festivalPoapContract (AttendancePOAP) — retains factory rights
  ├── deploys: sessionPoapContract (AttendancePOAP) — transfers factory to Festival
  └── deploys: Festival
        ├── mints via: festivalPoapContract.mintPOAP()
        ├── owns: sessionPoapContract (authorizes session minters)
        └── deploys: FestivalSession instances
```

**Roles:** `DEFAULT_ADMIN_ROLE`, `MANAGER_ROLE`, `VOLUNTEER_ROLE`

**Key flows:**

- `setup(metadataCid, channelMetadataCid, startTime, endTime, capacity)` — one-shot festival configuration after deploy
- `register()` — mints soulbound ticket (free, no pricing)
- `checkIn(attendee)` — mints festival POAP atomically
- `manualCheckIn(attendee)` — registers + checks in + mints POAP in one call
- `createSession()` — POAP-gated: only festival POAP holders can create sessions (max 2 per creator per festival day)
- `cancelSession(addr)` — routed through Festival; dual-path auth (session admin below the flag threshold, festival admin/manager above it)

All metadata is stored off-chain on the Bulletin Chain (CIDv1, Blake2b-256). Contracts store only `bytes32` CIDs — `metadataCid` (festival content) and `channelMetadataCid` (announcement channel). See `src/apps/events/README.md` for the full contract surface.

## Default dev chain (Paseo Asset Hub)

One registered network among several (see `packages/shared/host/networks.ts`);
shown here because it's the default target for local contract work.

| Property      | Value                                  |
| ------------- | -------------------------------------- |
| Chain         | Polkadot Hub TestNet (Paseo Asset Hub) |
| Chain ID      | 420420417                              |
| ETH RPC       | `https://eth-rpc-testnet.polkadot.io/` |
| Substrate WSS | `wss://asset-hub-paseo.ibp.network`    |

## Build & Test

```bash
make install    # Install forge-std + OpenZeppelin
make build      # Compile
make test       # Run tests
make copy-abis  # Copy ABIs to packages/shared/
```

## Deploy

```bash
make deploy-festival
make deploy-multicall  # Multicall3 (canonical source, custom-deployed bytecode) — see below
```

## Multicall3 on revive

`forge test` runs against a stock EVM (revm), so it doesn't validate behavior on pallet-revive, particularly Multicall3, which uses inline assembly that revive's EVM translation could in theory mishandle. To smoke-test on a live revive node:

```bash
# 1. Set DEPLOYER_SEED in contracts/.env (sr25519 mnemonic). Fund the derived
#    H160 with PAS on Polkadot Hub TestNet (a.k.a. Paseo Asset Hub) via
#    https://faucet.polkadot.io/ — pick "Paseo Asset Hub" as the destination chain.
# 2. Deploy. Prints "VITE_MULTICALL_ADDRESS=0x..." on success.
make deploy-multicall

# 3. Smoke-test the assembly + value-accounting paths via eth_call (no gas, no signer).
#    Reads VITE_MULTICALL_ADDRESS from .github/env.paseo-next-v2 automatically.
make test-revive
make test-revive VITE_MULTICALL_ADDRESS=0x...   # to test a different deployment
```

`make test-revive` covers `aggregate3` happy + assembly-revert paths, `aggregate3Value` happy + assembly-revert + value-mismatch paths, the legacy `aggregate`, and the block-introspection getters (split into must-pass vs may-revert categories). It does NOT exercise actual value transfer through `aggregate3Value` (would need a funded sender) or the `tryAggregate`/`blockAndAggregate` variants (same `target.call(...)` pattern as the tested ones). Defaults to Polkadot Hub TestNet's ETH-RPC; override with `ETH_RPC_URL=...` to point at a local revive dev-node.

## Dependencies

- Solidity ^0.8.20
- OpenZeppelin Contracts v5.5.0
- forge-std v1.15.0
