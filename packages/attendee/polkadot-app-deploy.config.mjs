/**
 * Product manifest for the Web3 Summit attendee app (polkadot-app-deploy).
 *
 * `domain` comes from VITE_DOTNS_ID at build time so one manifest works across
 * every environment; polkadot-app-deploy rejects a deploy unless it matches the
 * deploy domain.
 *
 * Not shipped as-is: `scripts/emit-manifest.mjs` evaluates this after the build
 * (with VITE_DOTNS_ID set) and writes a self-contained `out/polkadot-app-deploy.config.mjs`
 * with the domain frozen to a literal, since the env var is gone at deploy time.
 * The icon is read from `./icon.png` relative to that config (the build output
 * root); place it at `packages/attendee/public/icon.png` — Nuxt copies public/ into out/.
 */
export default {
  domain: process.env.VITE_DOTNS_ID ?? "web3summit.dot",
  displayName: "Web3 Summit App",
  description: "Your Web3 Summit companion",
  icon: { path: "./icon.png", format: "png" },
  executables: [
    { kind: "app", path: ".", appVersion: [0, 1, 0] },
    // Announcements chat extension (@festival/announcements-worker).
    // scripts/bundle-worker-into.mjs builds it with this build's VITE_* env and
    // drops the bundle at out/worker/index.js, so web3summit.dot ships the SPA
    // and the background chat worker as one installable product.
    {
      kind: "worker",
      path: "./worker",
      entrypoint: "index.js",
      includes: { chat: true, pocket: false },
      appVersion: [0, 0, 1],
    },
  ],
};
