import { fileURLToPath } from 'node:url'

const sharedPublicDir = fileURLToPath(new URL('../shared/public', import.meta.url))

// Bake the typed PAPI descriptors for the target network (VITE_NETWORK, from
// .env or $GITHUB_ENV on CI). If the network has no generated descriptor file
// yet, this alias points at a missing file and the build fails loudly rather
// than ship silently-wrong types.
const activeNetwork = process.env.VITE_NETWORK || 'paseo'
const activeDescriptors = fileURLToPath(
  new URL(`../shared/host/descriptors/${activeNetwork}.ts`, import.meta.url),
)

export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',

  future: {
    compatibilityVersion: 4,
  },

  ssr: false,

  app: {
    head: {
      link: [
        // Self-hosted Inter: preload the latin subset so text renders without a fallback flash
        { rel: 'preload', as: 'font', type: 'font/woff2', crossorigin: '', href: '/fonts/inter-v20-latin.woff2' },
      ],
    },
  },

  router: {
    options: {
      hashMode: true,
    },
  },

  modules: ['@pinia/nuxt'],

  components: [
    { path: '~/components/ui', pathPrefix: false },
    '~/components',
  ],

  css: ['~/assets/css/main.css'],

  vite: {
    resolve: {
      alias: {
        '#active-descriptors': activeDescriptors,
      },
    },
    plugins: [
      import('@tailwindcss/vite').then((m) => m.default()),
    ],
  },

  nitro: {
    output: {
      publicDir: 'out',
    },
    publicAssets: [
      { dir: sharedPublicDir, baseURL: '/', maxAge: 60 * 60 * 24 },
    ],
  },

  // Transpile the shared workspace package
  build: {
    transpile: ['@festival/shared'],
  },

  devtools: { enabled: true },
})
