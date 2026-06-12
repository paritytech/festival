/**
 * Product manifest for the Web3 Summit admin app (polkadot-app-deploy).
 *
 * `domain` comes from VITE_DOTNS_ID at build time so one manifest works across
 * every environment; polkadot-app-deploy rejects a deploy unless it matches the
 * deploy domain.
 *
 * This file is not shipped as-is: `scripts/emit-manifest.mjs` evaluates it (with
 * VITE_DOTNS_ID set) after the build and writes a self-contained
 * `out/polkadot-app-deploy.config.mjs` with the domain frozen to a literal, since the
 * env var is gone at deploy time. The icon is read from `./icon.png` relative to
 * that config (the build output root) — drop it at `packages/admin/public/icon.png`,
 * which Nuxt copies into out/.
 */
export default {
  domain: process.env.VITE_DOTNS_ID ?? "web3summit-admin.dot",
  displayName: "Web3 Summit Admin",
  description: "Web3 Summit management app",
  icon: { path: "./icon.png", format: "png" },
  executables: [{ kind: "app", path: ".", appVersion: [0, 1, 0] }],
};
