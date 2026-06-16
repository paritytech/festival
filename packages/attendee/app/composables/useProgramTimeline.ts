import { computed } from 'vue'
import type { ScheduleEntry, SessionCategory } from '@festival/shared/metadata/schemas'
import { isHappeningNow, toBerlinDateKey, formatDateBerlin, berlinHourOf, parseFestivalDate } from '@festival/shared/utils/time'
import { berlinHourToDate } from '@festival/shared/sessions/timeWindow'
import { useSchedule } from './useSchedule'
import { useSubEvents } from './useSubEvents'
import { useBookmarks } from './useBookmarks'
import { useHiddenSessions } from './useHiddenSessions'
import type { AttendeeSubEvent } from './useSubEvents'

// ── Discriminated union. No data transformation ──

export type TimelineItem =
  | { type: 'official'; entry: ScheduleEntry }
  | { type: 'community'; subEvent: AttendeeSubEvent }

export interface TimelineHourSlot {
  hour: number
  label: string
  items: TimelineItem[]
}

export interface TimelineDay {
  date: Date
  dateKey: string
  label: string
  dayNumber: number
  hourSlots: TimelineHourSlot[]
}

// ── Helpers ──

function getStartTime(item: TimelineItem): Date {
  return item.type === 'official'
    ? parseFestivalDate(item.entry.start)
    : new Date(item.subEvent.startTime * 1000)
}

function getEndTime(item: TimelineItem): Date {
  return item.type === 'official'
    ? parseFestivalDate(item.entry.end)
    : new Date(item.subEvent.endTime * 1000)
}

function formatDayLabel(d: Date): string {
  return formatDateBerlin(d, { weekday: 'long', day: 'numeric', month: 'short' })
}

function formatHourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

export function isItemOngoing(item: TimelineItem, now: number = Date.now()): boolean {
  if (item.type === 'official') {
    return isHappeningNow(item.entry.start, item.entry.end, now)
  }
  return isHappeningNow(
    new Date(item.subEvent.startTime * 1000).toISOString(),
    new Date(item.subEvent.endTime * 1000).toISOString(),
    now,
  )
}

export function isItemPast(item: TimelineItem, now: number = Date.now()): boolean {
  return getEndTime(item).getTime() < now
}

export function getItemId(item: TimelineItem): string {
  return item.type === 'official' ? item.entry.id : item.subEvent.address
}

// ── Category ──
//
// The timeline only cares whether an item is a schedule entry or a sub-event.
// Activations are schedule entries we tagged via `ScheduleEntry.category`, so we
// read the category off that rather than add a third variant to the union.
// CATEGORY_STYLE holds the label and color for each one. A new category needs an
// entry there, a `--color-<name>` token in main.css, and a pill in the legend
// (pages/program/index.vue).

export type CategoryStyle = { label: string; color: string }

export const CATEGORY_STYLE: Record<SessionCategory, CategoryStyle> = {
  official: { label: 'Official', color: '#fafaf9' },
  community: { label: 'Community', color: '#9462FA' },
  activations: { label: 'Activations', color: '#FFB300' },
}

export function scheduleEntryCategory(entry: ScheduleEntry): SessionCategory {
  return entry.category === 'activations' ? 'activations' : 'official'
}

export function getItemCategory(item: TimelineItem): SessionCategory {
  return item.type === 'community' ? 'community' : scheduleEntryCategory(item.entry)
}

// ── Composable ──

export function useProgramTimeline() {
  const { entries: scheduleEntries } = useSchedule()
  const { subEvents } = useSubEvents()
  const { bookmarkedIds } = useBookmarks()
  const { isHidden } = useHiddenSessions()

  const allItems = computed<TimelineItem[]>(() => {
    const official: TimelineItem[] = scheduleEntries.value.map(entry => ({ type: 'official', entry }))
    const community: TimelineItem[] = subEvents.value
      .filter(se => !isHidden(se.address))
      .map(subEvent => ({ type: 'community', subEvent }))
    return [...official, ...community].sort((a, b) => {
      const startDelta = getStartTime(a).getTime() - getStartTime(b).getTime()
      if (startDelta !== 0) return startDelta
      // Same start time → shorter sessions (earlier end) come first.
      return getEndTime(a).getTime() - getEndTime(b).getTime()
    })
  })

  const days = computed<TimelineDay[]>(() => {
    const dayMap = new Map<string, TimelineItem[]>()

    for (const item of allItems.value) {
      const key = toBerlinDateKey(getStartTime(item))
      if (!dayMap.has(key)) dayMap.set(key, [])
      dayMap.get(key)!.push(item)
    }

    const sortedKeys = [...dayMap.keys()].sort()

    return sortedKeys.map((dateKey, index) => {
      const items = dayMap.get(dateKey)!
      const date = berlinHourToDate(dateKey, 12)

      // Group by start hour
      const hourMap = new Map<number, TimelineItem[]>()
      for (const item of items) {
        const hour = berlinHourOf(getStartTime(item))
        if (!hourMap.has(hour)) hourMap.set(hour, [])
        hourMap.get(hour)!.push(item)
      }

      const hourSlots: TimelineHourSlot[] = [...hourMap.entries()]
        .sort(([a], [b]) => a - b)
        .map(([hour, slotItems]) => ({
          hour,
          label: formatHourLabel(hour),
          items: slotItems,
        }))

      return {
        date,
        dateKey,
        label: formatDayLabel(date),
        dayNumber: index + 1,
        hourSlots,
      }
    })
  })

  const myList = computed<TimelineItem[]>(() => {
    return allItems.value.filter(item => {
      if (item.type === 'official') {
        return bookmarkedIds.value.includes(item.entry.id)
      }
      return bookmarkedIds.value.includes(item.subEvent.address)
    })
  })

  const myListDays = computed<TimelineDay[]>(() => {
    const dayMap = new Map<string, TimelineItem[]>()

    for (const item of myList.value) {
      const key = toBerlinDateKey(getStartTime(item))
      if (!dayMap.has(key)) dayMap.set(key, [])
      dayMap.get(key)!.push(item)
    }

    const sortedKeys = [...dayMap.keys()].sort()

    return sortedKeys.map((dateKey, index) => {
      const items = dayMap.get(dateKey)!
      const date = berlinHourToDate(dateKey, 12)

      const hourMap = new Map<number, TimelineItem[]>()
      for (const item of items) {
        const hour = berlinHourOf(getStartTime(item))
        if (!hourMap.has(hour)) hourMap.set(hour, [])
        hourMap.get(hour)!.push(item)
      }

      const hourSlots: TimelineHourSlot[] = [...hourMap.entries()]
        .sort(([a], [b]) => a - b)
        .map(([hour, slotItems]) => ({
          hour,
          label: formatHourLabel(hour),
          items: slotItems,
        }))

      return {
        date,
        dateKey,
        label: formatDayLabel(date),
        dayNumber: index + 1,
        hourSlots,
      }
    })
  })

  return { allItems, days, myList, myListDays }
}
