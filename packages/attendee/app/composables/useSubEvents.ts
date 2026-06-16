import { computed } from 'vue'
import type { SubEventMetadata } from '@festival/shared/metadata/schemas'
import { useWalletStore } from '@festival/shared/host/wallet'
import { walletAddressToH160 } from '@festival/shared/utils/address'
import { festivalState, type SessionEntry } from '@festival/shared/cache/festival-state'
import { hasPending, pendingSessions, pendingSessionEdit, sessionScopedId } from '@festival/shared/cache/pending'
import { bootLoadAttendee } from './useBootLoad'

export interface AttendeeSubEvent {
  address: string
  creator: string
  metadata: SubEventMetadata
  registeredCount: number
  capacity: number
  startTime: number
  endTime: number
  isRegistered: boolean
  isCheckedIn: boolean
}

const DEFAULT_METADATA: SubEventMetadata = {
  version: '1.0',
  type: 'sub-event',
  name: '',
  description: '',
  location: '',
  speakers: [],
}

/**
 * Sub-events composable. Derives an `AttendeeSubEvent[]` view from
 * `festivalState.sessions`, applying the current user's registration /
 * check-in status from each session's attendees array (no extra reads).
 */
export function useSubEvents() {
  const subEvents = computed<AttendeeSubEvent[]>(() => {
    const userLower = festivalState.user.address?.toLowerCase() ?? null

    const toView = (s: SessionEntry): AttendeeSubEvent => {
      const userRow = userLower
        ? s.attendees.find((a) => a.address.toLowerCase() === userLower)
        : undefined
      // Confirmed row, or our own in flight check in for this session.
      const pendingCheckIn = userLower
        ? hasPending('checkin', sessionScopedId(userLower, s.address))
        : false
      // Our own in-flight edit renders immediately; superseded once the chain CID catches up.
      const edit = pendingSessionEdit(s.address)
      return {
        address: s.address,
        creator: s.details.creator,
        metadata: edit?.metadata ?? s.metadata ?? { ...DEFAULT_METADATA, name: `Sub-Event ${s.address.slice(0, 8)}` },
        registeredCount: Number(s.details.registeredCount),
        capacity: 0,
        startTime: Number(s.details.startTime),
        endTime: Number(s.details.endTime),
        isRegistered: Boolean(userRow) || pendingCheckIn,
        isCheckedIn: (userRow?.isCheckedIn ?? false) || pendingCheckIn,
      }
    }

    const confirmed = festivalState.sessions
      .filter((s) => !s.details.cancelled && !hasPending('cancelSession', s.address))
      .map(toView)

    // Splice in this device's in flight drafts. A live confirmed entry with
    // the same CID supersedes its draft. Cancelled ones do not count because
    // a recreate with the same metadata shares their CID.
    const confirmedCids = new Set(
      festivalState.sessions
        .filter((s) => !s.details.cancelled)
        .map((s) => s.details.metadataCid.toLowerCase()),
    )
    const drafts = pendingSessions()
      .filter((s) => !confirmedCids.has(s.details.metadataCid.toLowerCase()))
      .map(toView)

    return [...confirmed, ...drafts]
  })

  const isLoading = computed(() => festivalState.loading)

  function getByAddress(addr: string) {
    return subEvents.value.find((se) => se.address === addr)
  }

  function reload(): Promise<void> {
    const wallet = useWalletStore()
    const userH160 = wallet.isConnected ? walletAddressToH160(wallet.address) : null
    return bootLoadAttendee(userH160)
  }

  return { subEvents, getByAddress, isLoading, reload }
}
