# Deploying the Festival System Prototype

One command stands up a full instance: contracts on-chain, frontend built, and
publish handed to GitHub Actions:

```bash
npm run setup
```

It's a guided wizard: it checks your environment, asks a few questions, deploys
the contracts, builds the two SPAs, and prepares the DotNS publish. Nothing
touches the chain until you confirm a summary, and re-running resumes where you
left off.

---

## Prerequisites

| Need                          | Why                                                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Node ≥ 20.19**              | Runs the tooling and SPAs                                                                                            |
| **Foundry** (`forge`)         | Compiles the contracts — install via <https://getfoundry.sh> then `foundryup`                                        |
| **git**                       | Repo + (optional) CI publish                                                                                         |
| **gh** (optional)             | Lets the wizard set repo secrets and trigger the publish for you                                                     |
| **A funded deployer account** | Pays for contract deployment. On Paseo, fund it with PAS at <https://faucet.polkadot.io/> (pick **Paseo Asset Hub**) |
| **Two `.dot` domains you own** | The Admin + Attendee SPAs publish to these; readiness blocks if the publisher doesn't own them                       |

Install workspace dependencies once:

```bash
npm install
```

## 1. Configure secrets

```bash
cp .env.example .env
```

Edit `.env` and set at least `DEPLOYER_SEED` (a 12/24-word mnemonic). Optionally
set `DOTNS_MNEMONIC` if a different account owns your DotNS domains; otherwise the
deployer seed is reused for publishing. `.env` is gitignored — never commit it.

## 2. Run the wizard

```bash
npm run setup
```

What happens, phase by phase:

1. **Environment** — checks Node, Foundry, git, gh versions.
2. **Configure** — pick the network, confirm the deployer/publisher accounts
   (shown as `SS58 (0xH160)` — derived from your seed, never typed), and set the
   two DotNS domains. Saved to `deploy.config.json`.
3. **Readiness** — confirms the RPC is reachable, the deployer is funded, and
   checks DotNS ownership + personhood for your domains. An unfunded deployer or
   a domain the publisher doesn't own blocks the run; override the DotNS gate
   with `--skip-dotns-check`.
4. **Build contracts** — installs forge-std + OpenZeppelin if missing, then
   `forge build` + copy ABIs.
5. **Deploy** — Multicall3, the two AttendancePOAPs, and the Festival; addresses
   are written into `packages/{admin,attendee}/.env.<network>`.
6. **Roles** — optionally grant `VOLUNTEER_ROLE` to door staff.
7. **Build frontend** — `nuxt generate` for both SPAs → `packages/*/out`.
8. **Publish** — writes `.github/env.<network>` and hands the DotNS publish to
   GitHub Actions (see below).

> Festival **content** (name, dates, schedule, venue map) is **not** set by this
> script. Open the Admin app in the Polkadot Host and use its one-time
> "Setup festival" form, that writes the metadata to the Bulletin Chain.

## 3. Publish the frontend (GitHub Actions)

The static build is published to IPFS + DotNS by the **Deploy** workflow
(`.github/workflows/deploy.yml`), using your `DOTNS_MNEMONIC`.

- **With `gh`:** the wizard offers to set the repo secrets and trigger the
  workflow for you.
- **Without `gh`:** in your fork, add the secrets (Settings → Secrets), then run
  the workflow (Actions → **Deploy** → Run workflow), or:

  ```bash
  gh workflow run deploy.yml
  ```

Three secrets, three distinct accounts (they may differ):

- `DOTNS_MNEMONIC` — owns the `.dot` domains and publishes (required by the Deploy/Release/PR-Preview workflows).
- `DEPLOYER_SEED` — deploys the contracts.
- `E2E_DEPLOYER_SEED` — funds the e2e workflow's test deploys (test-only).

Commit the generated `.github/env.<network>` file so the workflow can read your
addresses and domains.

You can also serve the build locally without DotNS:

```bash
npx serve packages/attendee/out
```

---

## Networks

Built-in: `paseo-next-v2`, `paseo`.

**Custom chain:** choose `custom…` in the wizard (or set `"network": "custom"` in
`deploy.config.json` with a `custom` block / `CUSTOM_*` env vars). You supply the
Asset Hub WS URL, optional genesis hash, Bulletin WS URL, and native token info.
Contract deploy + frontend build work on any chain.

The DotNS personhood/ownership advisory needs the chain's DotNS contract
addresses — there's no on-chain discovery for them. For the built-in networks
they're baked in (from DotNS's `environments.json`). For a custom chain, optionally
supply **PopRules** and **Registrar** addresses (the wizard prompts for them, or add
`dotnsPopRules` / `dotnsRegistrar` to the `custom` block in `deploy.config.json`) to
enable the advisory; leave them blank to skip it. CI publish targets the built-in
DotNS environments only.

## Non-interactive / CI

```bash
npm run setup -- --network paseo-next-v2 --yes     # no prompts; reads deploy.config.json + .env
npm run setup -- --dry-run                         # phases 1–3 only, no on-chain writes
```

Flags: `--network <key>`, `--yes`, `--dry-run`, `--skip-contracts`,
`--skip-frontend`, `--skip-dotns-check`, `--config <path>`.

## Re-running / resume

State lives in `.deploy/state.<network>.json`. A re-run skips already-deployed
contracts and completed builds. Delete that file to force a clean redeploy.

## Troubleshooting

| Symptom                                    | Fix                                                                          |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| `BLOCKED: deployer has no PAS`             | Fund the shown account at the faucet, re-run.                                |
| `Asset Hub RPC unreachable`                | Check your connection / the WS URL; retry.                                   |
| `DotNS gating unavailable on this network` | Expected on `paseo`/custom chains — advisory only, deploy still proceeds.    |
| `make copy-abis failed`                    | Libs auto-install on first run; if it still fails, run `cd contracts && make install`. |
| Readiness blocks on domain ownership       | Use domains the publisher owns, or re-run with `--skip-dotns-check`.                    |
| Frontend build fails                       | Ensure `npm install` ran at the repo root first.                             |
