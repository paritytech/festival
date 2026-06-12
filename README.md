> [!WARNING]
> The following is a prototype, reference implementation, and proof-of-concept. This open source code is provided for research, experimentation, and developer education only. This code has not been audited, is actively experimental, and may contain bugs, vulnerabilities, or incomplete features. Use at your own risk.

# Festival System Prototype

A Web3 festival management prototype built on Polkadot. On-chain soulbound tickets, attendance POAPs, and composable sessions (unconference-style sub-events). Runs inside the Polkadot Host (desktop, mobile, web).

## Project Structure

```
conference-app/
├── contracts/           # Solidity (Foundry) — Festival, FestivalSession, AttendancePOAP
├── packages/
│   ├── shared/          # Pure TypeScript library — contract helpers, metadata, host, wallet
│   ├── admin/           # Admin Nuxt SPA (desktop-friendly) — festival creation, check-in, roles
│   ├── attendee/        # Attendee Nuxt SPA (mobile-first) — registration, schedule, map, badges
│   └── announcements-worker/  # Polkadot chat extension (worker) — posts on-chain announcements into host chat
├── scripts/             # setup.ts (guided deploy) + deploy/ chain/ e2e/ maps/ lib/
└── .claude/spec/        # Festival spec (source of truth)
```

## Tech Stack

- **Contracts:** Solidity ^0.8.20, Foundry, OpenZeppelin v5.5.0
- **Frontend:** Nuxt 3, Vue 3, TypeScript, Tailwind CSS v4, Pinia
- **Chain client:** PAPI (polkadot-api) for reads + writes, viem for ABI encoding
- **Chain:** Paseo Next V2
- **Metadata:** Bulletin Chain (pallet-transaction-storage), CIDv1 Blake2b-256

## Deployed Contracts (Paseo Next V2)

| Contract                | Address                                      |
| ----------------------- | -------------------------------------------- |
| Festival                | `0xc47c785e120b4b13589423406a5d4ec2c68b407b` |
| Festival AttendancePOAP | `0x1d8c736c0d449d4b0c78262af2268f8e206243d8` |
| Session AttendancePOAP  | `0xa97fc2bfc59a58778807ba34e8b57402536a786a` |
| Multicall3              | `0x2c2fdf374009bc4f2af002c887fd962b63a68d89` |

Upstream reference deployment: your own `npm run setup` writes fresh addresses
to `.github/env.paseo-next-v2` and `packages/*/.env.<network>`.

## Getting Started

### Deploy everything (recommended)

One guided command stands up a full instance: contracts on-chain, frontend
built, and DotNS publish handed to CI:

```bash
npm install
cp .env.example .env        # set DEPLOYER_SEED (a funded mnemonic)
npm run setup               # interactive wizard
```

`npm run setup` installs the contract libraries (forge-std + OpenZeppelin) on
first run if they're missing.

See **[DEPLOY.md](./DEPLOY.md)** for the full walkthrough, networks (including
custom chains), non-interactive/CI usage, and troubleshooting.

### Contracts (manual)

```bash
cd contracts
make install   # Install forge-std + OpenZeppelin
make build     # Compile
make test      # Run tests
```

### Frontend (local dev)

```bash
npm install                              # Install all workspaces
cp packages/admin/.env.example packages/admin/.env
cp packages/attendee/.env.example packages/attendee/.env
npm run -w packages/admin dev            # Admin SPA dev server
npm run -w packages/attendee dev         # Attendee SPA dev server
```

You can also run `npm run dev:<mode>:<network>` to target a specific configuration. For example, running `npm run dev:attende:paseo-next-v2` will get a local development version with the configuration on .env.paseo-next-v2` and will target the Paseo Next V2 network configuration.

## Environment Variables

Each SPA needs a `.env` file. Copy from `.env.example`:

| Variable                                            | Description                                                                      |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| `VITE_FESTIVAL_ADDRESS`                             | Festival contract address                                                        |
| `VITE_FESTIVAL_POAP_ADDRESS`                        | Festival-level AttendancePOAP address                                            |
| `VITE_SUB_EVENT_POAP_ADDRESS`                       | Session-level AttendancePOAP address (env key keeps the legacy `SUB_EVENT` name) |
| `VITE_MULTICALL_ADDRESS`                            | Multicall3 address for batched on-chain reads                                    |
| `VITE_DOTNS_ID`                                     | DotNS domain id used by the host for registration wiring                         |
| `VITE_DEV_SEED` (for local development)             | Signer seed that bypases signing outside of the host for faster development      |
| `VITE_BULLETIN_SIGNER_SEED` (for local development) | Mnemonic for Bulletin Chain app account                                          |

CI builds load these from `.github/env.paseo-next-v2`.

## Adding a Network

There are two ways to point the app at a different chain:

- **One-off (no code changes)** — run `npm run setup`, pick **`custom…`**, and
  enter the chain's details at the prompt. Nothing is committed. See
  [DEPLOY.md](./DEPLOY.md#networks). Use this to try a chain quickly.
- **Permanent (committed built-in)** — register the chain so it appears
  everywhere (the wizard, builds, CI). The steps below.

### Information you'll need

| Item                                                  | Where to get it                                                                                                                                                                                             |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Main chain WSS URL**                                | The Asset Hub-like parachain RPC (pallet-revive lives here)                                                                                                                                                 |
| **Main chain genesis hash**                           | `NETWORK=<key> npx tsx scripts/chain/sync-network.ts` (or `chain_getBlockHash[0]`)                                                                                                                          |
| **Bulletin chain WSS URL + genesis hash**             | The Bulletin chain RPC (metadata storage). `null` if the network has none                                                                                                                                   |
| **IPFS gateway URL** (for local development failsafe) | HTTP gateway that resolves Bulletin CIDs                                                                                                                                                                    |
| **Native token**                                      | `symbol` + `decimals` (e.g. `PAS` / `10`)                                                                                                                                                                   |
| **DotNS contract addresses** (optional)               | `POP_RULES` + `DOTNS_REGISTRAR` from the chain's DotNS deployment — there's no on-chain discovery; get them from whoever deployed DotNS on the chain (built-in values live in `scripts/lib/dotns-check.ts`) |

### Steps

1. **Register the chain** in `packages/shared/host/networks.ts` (the single
   source of truth):
   - add the key to the `NetworkKey` union and `SUPPORTED_NETWORKS`;
   - add a `NETWORKS` entry with `mainChain` / `bulletinChain` (WSS + genesis +
     optional `descriptorKey`), `ipfsGateway`, and `nativeToken`.

2. **Generate PAPI descriptors** (needed for typed chain reads). Set a
   `descriptorKey` on each chain in the entry, then:

   ```bash
   npm run papi:update   # fetches each chain's metadata .scale + regenerates descriptors
   ```

   Commit the generated files under `packages/shared/.papi/` and
   `packages/shared/host/descriptors/`. A network _can_ be registered without a
   `descriptorKey` (connection/deploy still work) — only typed reads need it.

3. **Expose it to the deploy wizard** — add the key to `BUILT_IN_NETWORKS` in
   `scripts/lib/config.ts` so it shows up in `npm run setup`.

4. **(Optional) DotNS advisory** — add a `popRules` + `registrar` entry under the
   new key to `DOTNS_CONTRACTS_BY_NETWORK` in `scripts/lib/dotns-check.ts` to
   enable the personhood/ownership readiness check. Skip if the chain has no DotNS.

5. **(Optional) env templates** — add `packages/{admin,attendee}/.env.<key>.example`
   so contributors have a starting point (the deploy script writes the real
   `.env.<key>` automatically).

6. **(Optional) CI publish** — add the key to the `network` input options in
   `.github/workflows/deploy.yml`. DotNS publish only works on chains that have a
   supported DotNS publish environment.

Genesis hashes, descriptors, and the `postinstall` hook all regenerate
deterministically from the registry, so step 1 is the only required edit to
_connect_; the rest progressively unlock typed reads, the wizard, the DotNS
advisory, and CI.

## Security

Before deploying it for real use cases, you are responsible for:

- Reviewing the code yourself, we publish a reference, not a hardened production build
- Checking that the dependencies are up to date and free of known vulnerabilities
- Securing your own fork or deployment environment (keys, secrets, network configuration)
- Tracking the latest tagged release/commits for security fixes; older releases are not backported (exceptions might apply)

For Parity's security disclosure process, and Bug Bounty program, feel free to visit: https://parity.io/bug-bounty

## License

Licensed under [GPL-3.0-only](LICENSE). Vendored third-party code retains its
own licence — the contracts under `contracts/lib/` (OpenZeppelin, forge-std) and
the Multicall3 sources (`contracts/src/protocols/multicall/`,
`contracts/src/mocks/`) remain MIT.
