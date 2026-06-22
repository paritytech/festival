import { ref, computed } from 'vue'
import { h160ToSs58, walletAddressToH160 } from '@festival/shared/utils/address'
import { useWalletStore } from '@festival/shared/host/wallet'
import { festivalState } from '@festival/shared/cache/festival-state'
import { pendingCheckins } from '@festival/shared/cache/pending'
import { bootLoadAdmin } from './useBootLoad'

export interface CheckedInAttendee {
  address: `0x${string}`
  checkedInAt: number
}

/**
 * Attendees composable. Derives `CheckedInAttendee[]` from the POAP data
 * already fetched by bootLoadAdmin (each POAP entry's `issuedAt` is the
 * check-in timestamp). Sorted most-recent-first to match prior behavior.
 */
export function useAttendees(festivalAddress: string) {
  const search = ref('')

  const attendees = computed<CheckedInAttendee[]>(() => {
    const fromPoaps = festivalState.user.festivalPoaps.map((p) => ({
      address: p.data.attendee,
      checkedInAt: Number(p.data.issuedAt),
    }))
    const seen = new Set(fromPoaps.map((a) => a.address.toLowerCase()))

    // POAP data only refreshes on boot loads, so bridge the gap with rows the
    // chain already confirmed checked-in (event-fed attendees array) and this
    // device's in-flight check-ins. Their exact timestamp arrives with the
    // POAP on the next load; until then they're simply "just now".
    const nowSec = Math.floor(Date.now() / 1000)
    const bridged: CheckedInAttendee[] = []
    for (const a of festivalState.festival?.attendees ?? []) {
      if (a.isCheckedIn && !seen.has(a.address.toLowerCase())) {
        seen.add(a.address.toLowerCase())
        bridged.push({ address: a.address, checkedInAt: nowSec })
      }
    }
    for (const addr of pendingCheckins()) {
      if (!seen.has(addr)) {
        seen.add(addr)
        bridged.push({ address: addr as `0x${string}`, checkedInAt: nowSec })
      }
    }

    return [...fromPoaps, ...bridged].sort((a, b) => b.checkedInAt - a.checkedInAt)
  })

  const filtered = computed(() => {
    const q = search.value.trim().toLowerCase()
    if (!q) return attendees.value
    return attendees.value.filter((a) => {
      if (a.address.toLowerCase().includes(q)) return true
      return h160ToSs58(a.address).toLowerCase().includes(q)
    })
  })

  const stats = computed(() => ({ checkedIn: attendees.value.length }))
  const isLoading = computed(() => festivalState.loading)

  function reload(): Promise<void> {
    const wallet = useWalletStore()
    const userH160 = wallet.isConnected ? walletAddressToH160(wallet.address) : null
    return bootLoadAdmin(festivalAddress as `0x${string}`, userH160)
  }

  return { attendees, filtered, search, stats, isLoading, reload }
}
