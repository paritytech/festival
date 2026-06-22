import { getNotificationManager, PushNotificationError } from '@parity/product-sdk-host'
import { isInHost } from './detect'

export type NotificationId = number

/**
 * Returned by {@link pushNotification} when the host cannot accept any more
 * pending scheduled notifications. Caller should surface this to the user;
 * the bookmark itself (if any) should still be persisted.
 */
export const SCHEDULE_LIMIT_REACHED = 'schedule-limit-reached' as const
export type ScheduleLimitReached = typeof SCHEDULE_LIMIT_REACHED

export interface PushNotificationInput {
  text: string
  deeplink?: string
  /** Unix timestamp in milliseconds (UTC). Omit for immediate delivery. */
  scheduledAt?: number
}

/**
 * Schedule (or immediately fire, if `scheduledAt` is omitted) a push
 * notification. Returns the host-assigned NotificationId, the
 * SCHEDULE_LIMIT_REACHED sentinel when the host has hit its platform-wide cap,
 * or null when not running inside a host or on any other failure.
 */
export async function pushNotification(
  input: PushNotificationInput,
): Promise<NotificationId | ScheduleLimitReached | null> {
  if (!isInHost()) return null

  const mgr = await getNotificationManager()
  if (!mgr) return null

  try {
    return await mgr.push(input)
  } catch (err) {
    if (err instanceof PushNotificationError.ScheduleLimitReached) {
      return SCHEDULE_LIMIT_REACHED
    }
    console.warn('[Notifications] Push failed:', err)
    return null
  }
}

/**
 * Cancel a previously scheduled notification by host-assigned id.
 * Idempotent host-side; we still try/catch in case the call itself fails.
 */
export async function cancelNotification(id: NotificationId): Promise<void> {
  if (!isInHost()) return

  const mgr = await getNotificationManager()
  if (!mgr) return

  try {
    await mgr.cancel(id)
  } catch (err) {
    console.warn('[Notifications] Cancel failed:', err)
  }
}

/**
 * Back-compat shim for immediate notifications. Returns true on success.
 */
export async function sendNotification(text: string, deeplink?: string): Promise<boolean> {
  const result = await pushNotification({ text, deeplink })
  return typeof result === 'number'
}
