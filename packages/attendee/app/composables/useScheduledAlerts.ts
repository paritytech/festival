import {
  pushNotification,
  cancelNotification,
  SCHEDULE_LIMIT_REACHED,
  type NotificationId,
} from '@festival/shared/host/notifications'
import { requestNotificationsPermission } from '@festival/shared/host/permissions'
import { usePersistentRef } from '@festival/shared/cache/persistent'

const STORAGE_KEY = 'festival-scheduled-alert-ids'
const LEAD_TIME_MS = 10 * 60_000
const LEAD_MINUTES = Math.round(LEAD_TIME_MS / 60_000)

export interface ScheduleAlertInput {
  id: string         // sessionId (schedule entry id or sub-event address)
  startMs: number
  title: string
  /** Relative app route, e.g. `/#/program/<id>`. Host-qualified before scheduling — see {@link toHostDeeplink}. */
  deeplink: string
  /** Optional human-readable location; appended to the notification body when present. */
  location?: string
}

function formatNotificationText(input: ScheduleAlertInput): string {
  const head = `${input.title} starts in ${LEAD_MINUTES} min`
  return input.location ? `${head} at ${input.location}` : head
}

/**
 * The host re-opens the product on notification tap by resolving which product
 * to open from the deeplink's HOST; a bare relative `/#/...` has no host and
 * silently fails to route. A notification is scheduled and tapped on the same
 * host, so `window.location.origin` (e.g. `polkadot://web3summit.dot` inside the
 * iOS host) is exactly the host-qualified form that host's resolver expects,
 * yielding `polkadot://web3summit.dot/#/program/<id>`.
 */
export function toHostDeeplink(route: string): string {
  if (typeof window === 'undefined' || !route.startsWith('/')) return route
  const origin = window.location.origin
  if (!origin || origin === 'null') return route
  return origin + route
}

export type ScheduleAlertOutcome =
  | 'scheduled'
  | 'too-late'           // fireAt already in the past
  | 'permission-denied'
  | 'limit-reached'
  | 'failed'

type IdMap = Record<string, NotificationId>

// Durable: losing this map orphans uncancellable OS notifications, so it must
// survive WebView eviction, not just live in localStorage.
const idMap = usePersistentRef<IdMap>(STORAGE_KEY, {})

export function useScheduledAlerts() {
  async function schedule(input: ScheduleAlertInput): Promise<ScheduleAlertOutcome> {
    const fireAt = input.startMs - LEAD_TIME_MS
    if (fireAt <= Date.now()) return 'too-late'

    const granted = await requestNotificationsPermission()
    if (!granted) return 'permission-denied'

    const result = await pushNotification({
      text: formatNotificationText(input),
      deeplink: toHostDeeplink(input.deeplink),
      scheduledAt: fireAt,
    })

    if (result === SCHEDULE_LIMIT_REACHED) return 'limit-reached'
    if (result === null) return 'failed'

    idMap.value = { ...idMap.value, [input.id]: result }
    return 'scheduled'
  }

  async function cancel(sessionId: string): Promise<void> {
    const notifId = idMap.value[sessionId]
    if (notifId === undefined) return

    await cancelNotification(notifId)

    const next = { ...idMap.value }
    delete next[sessionId]
    idMap.value = next
  }

  return { schedule, cancel }
}
