import { usePersistentRef } from '@festival/shared/cache/persistent'

// Durable across mobile WebView eviction; write-through is automatic.
const hiddenAddresses = usePersistentRef<string[]>('festival-hidden-sessions', [])

export function useHiddenSessions() {
  function hide(address: string) {
    const lower = address.toLowerCase()
    if (!hiddenAddresses.value.includes(lower)) {
      hiddenAddresses.value.push(lower)
    }
  }

  function isHidden(address: string): boolean {
    return hiddenAddresses.value.includes(address.toLowerCase())
  }

  return { hiddenAddresses, hide, isHidden }
}
