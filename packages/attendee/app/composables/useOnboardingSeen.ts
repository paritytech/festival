import { usePersistentRef } from '@festival/shared/cache/persistent'

// Stored as a string array (unchanged on-disk format); durable, write-through.
const seen = usePersistentRef<string[]>('festival-onboarding-seen', [])

export function useOnboardingSeen() {
  function has(key: string): boolean {
    return seen.value.includes(key)
  }

  function markSeen(key: string) {
    if (seen.value.includes(key)) return
    seen.value.push(key)
  }

  return { has, markSeen }
}
