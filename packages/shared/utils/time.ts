import { berlinHourToDate } from '../sessions/timeWindow'

const BERLIN_TZ = 'Europe/Berlin'

type DateInput = Date | string

/**
 * Captures (date, hour, minute) from an ISO 8601 string WITHOUT a TZ designator,
 * e.g. `2025-06-18T09:00`, `2025-06-18T09:00:00`, or `2025-06-18T09:00:00.000`.
 * End-anchored so strings with a trailing `Z` or `±HH:MM` offset do NOT match;
 * those carry their own TZ and must pass through to `new Date(d)` instead of
 * being reinterpreted as Berlin local.
 */
const NAIVE_ISO_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/

/**
 * Parse a date input. ISO strings without a TZ designator (e.g. values from
 * `<input type="datetime-local">`) are interpreted as Berlin local time,
 * the festival's canonical TZ. ISO strings with a Z/offset and bare Date
 * objects are returned as-is.
 */
export function parseFestivalDate(d: DateInput): Date {
  if (d instanceof Date) return d
  const m = NAIVE_ISO_RE.exec(d)
  if (m) return berlinHourToDate(m[1]!, Number(m[2]), Number(m[3]))
  return new Date(d)
}

/** Convert a Berlin-form (YYYY-MM-DD date + HH:MM time) to unix seconds. */
export function berlinFormToUnix(dateStr: string, timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number)
  return Math.floor(berlinHourToDate(dateStr, h ?? 0, m ?? 0).getTime() / 1000)
}

/** Format a unix timestamp to human-readable date/time in Berlin timezone. */
export function formatTimestamp(unix: number): string {
  return new Date(unix * 1000).toLocaleString('en-GB', {
    timeZone: BERLIN_TZ,
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

/** Format a duration in seconds to human-readable. E.g., 9000 → "2h 30m" */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

/** Check if a time range is happening now. ISO 8601 strings (TZ-less = Berlin). */
export function isHappeningNow(start: string, end: string, now: number = Date.now()): boolean {
  return now >= parseFestivalDate(start).getTime() && now <= parseFestivalDate(end).getTime()
}

/** True if both dates fall on the same calendar day in the local timezone. */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/**
 * Convert a unix timestamp (seconds) to HTML input bounds, in Berlin wall-clock parts.
 * Returns { date: 'YYYY-MM-DD', time: 'HH:MM', datetimeLocal: 'YYYY-MM-DDTHH:MM' }.
 * The strings are Berlin parts intended for `<input type="date|time|datetime-local">`
 * which the browser interprets in local TZ. Consistent with the form-submit path that
 * treats the entered values as Berlin local.
 */
export function timestampToInputBounds(unix: bigint | number): {
  date: string
  time: string
  datetimeLocal: string
} {
  const d = new Date(Number(unix) * 1000)
  const parts: Record<string, string> = {}
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: BERLIN_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  for (const p of fmt.formatToParts(d)) {
    if (p.type !== 'literal') parts[p.type] = p.value
  }
  const hour = (Number(parts.hour) % 24).toString().padStart(2, '0')
  const date = `${parts.year}-${parts.month}-${parts.day}`
  const time = `${hour}:${parts.minute}`
  return { date, time, datetimeLocal: `${date}T${time}` }
}

/** Format ISO date or Date to "HH:MM" in Berlin timezone (24h). */
export function formatTimeBerlin(d: DateInput): string {
  return parseFestivalDate(d).toLocaleTimeString('en-GB', {
    timeZone: BERLIN_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/** Format date in Berlin timezone. Default: "Thursday, 22 May". */
export function formatDateBerlin(
  d: DateInput,
  options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' },
  locale = 'en-GB',
): string {
  return parseFestivalDate(d).toLocaleDateString(locale, { ...options, timeZone: BERLIN_TZ })
}

/** Format date+time in Berlin timezone. Default: medium date + short time. */
export function formatDateTimeBerlin(
  d: DateInput,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
  locale = 'en-GB',
): string {
  return parseFestivalDate(d).toLocaleString(locale, { ...options, timeZone: BERLIN_TZ })
}

/** Hour-of-day (0–23) in Berlin timezone. Used for grouping into hour buckets. */
export function berlinHourOf(d: DateInput): number {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: BERLIN_TZ,
    hour: '2-digit',
    hour12: false,
  })
  return Number(fmt.format(parseFestivalDate(d))) % 24
}

/** Get YYYY-MM-DD date key in Berlin timezone. */
export function toBerlinDateKey(d: DateInput): string {
  return parseFestivalDate(d).toLocaleDateString('en-CA', { timeZone: BERLIN_TZ })
}

/**
 * Window after a session's `endTime` during which a volunteer can still
 * issue `manualCheckIn` (the contract has no time gate, so this is purely
 * a UX choice). Inside the window we keep the `Collect Badge` CTA live and
 * count down the time left to claim ("Closes in N min"); after it we show
 * "Session ended".
 */
export const SESSION_CHECKIN_GRACE_MS = 59 * 60 * 1000

/**
 * Round up to whole minutes and format as "Xh Ym" or "Ym" (no seconds).
 * Returns "0m" when within the next 30s. Callers should switch state
 * before this renders.
 */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return '0m'
  const totalMinutes = Math.ceil(ms / 60_000)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

/**
 * Minutes-only countdown for the post-session "Collect Badge · Closes in N min"
 * CTA. The remaining window is always <= SESSION_CHECKIN_GRACE_MS (under an
 * hour), so we never need hours. Rounds up to whole minutes and floors at
 * "1 min" so the label never reads "0 min" during the 30s tick gap before the
 * state flips to ended.
 */
export function formatClosesIn(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000))
  return `${minutes} min`
}

/** Human-readable time until a date. E.g., "in 5 minutes", "in 2 hours" */
export function timeUntil(isoDate: string): string {
  const diff = parseFestivalDate(isoDate).getTime() - Date.now()
  if (diff <= 0) return 'now'

  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'in less than a minute'
  if (minutes < 60) return `in ${minutes} minute${minutes !== 1 ? 's' : ''}`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `in ${hours} hour${hours !== 1 ? 's' : ''}`

  const days = Math.floor(hours / 24)
  return `in ${days} day${days !== 1 ? 's' : ''}`
}
