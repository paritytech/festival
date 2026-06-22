import { ref, readonly, type Ref } from 'vue'
import { getThemeProvider, type ThemeMode } from '@parity/product-sdk-host'
import { isInHost } from './detect'

export type ThemeSlug = 'berlin-night' | 'berlin-day' | 'lisbon' | 'malta' | 'tokyo'
export type ThemeVariant = 'Light' | 'Dark'

const DEFAULT_SLUG: ThemeSlug = 'berlin-night'

// Maps the iOS Custom theme `name.value` to our CSS slug. The iOS package emits
// theme ids that match the ThemeSelection enum case (e.g. "berlinNight"). We
// accept a few common shapes (camelCase, kebab, lowercase, underscored) so a
// rename on the host side doesn't immediately break us.
const NAME_MAP: Record<string, ThemeSlug> = {
  'berlinnight':  'berlin-night',
  'berlin-night': 'berlin-night',
  'berlindarknight': 'berlin-night',
  'berlinday':    'berlin-day',
  'berlin-day':   'berlin-day',
  'lisbon':       'lisbon',
  'malta':        'malta',
  'tokyo':        'tokyo',
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[_\s]+/g, '-')
}

export function pickTheme(payload: ThemeMode): ThemeSlug {
  if (payload.name.tag === 'Custom') {
    const slug = NAME_MAP[normalize(payload.name.value)]
    if (slug) return slug
  }
  // Default name or unknown custom value: fall back by variant.
  return payload.variant === 'Light' ? 'berlin-day' : 'berlin-night'
}

// Module-level singleton so multiple components share a single subscription.
const themeSlug = ref<ThemeSlug>(DEFAULT_SLUG)
const themeVariant = ref<ThemeVariant>('Dark')
let started = false
let unsubscribe: (() => void) | null = null

async function start() {
  if (started || typeof window === 'undefined' || !isInHost()) return
  started = true

  const provider = await getThemeProvider()
  if (!provider) {
    // Host SDK unavailable — allow a later retry.
    started = false
    return
  }

  const sub = provider.subscribeTheme((payload) => {
    themeSlug.value = pickTheme(payload)
    themeVariant.value = payload.variant
  })
  unsubscribe = () => sub.unsubscribe()
}

export function stopHostTheme() {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
  started = false
}

export function useHostTheme(): {
  themeSlug: Readonly<Ref<ThemeSlug>>
  variant: Readonly<Ref<ThemeVariant>>
} {
  // Fire-and-forget: the subscription updates the refs once it resolves.
  void start()
  return {
    themeSlug: readonly(themeSlug),
    variant: readonly(themeVariant),
  }
}
