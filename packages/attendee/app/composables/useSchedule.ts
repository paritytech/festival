import { computed } from 'vue'
import { isHappeningNow, parseFestivalDate } from '@festival/shared/utils/time'
import type { ScheduleEntry } from '@festival/shared/metadata/schemas'
import { useBookmarks } from './useBookmarks'
import { useFestival } from './useFestival'

const { metadata } = useFestival()

export function useSchedule() {
  const { isBookmarked } = useBookmarks()

  const entries = computed<ScheduleEntry[]>(() => metadata.value?.schedule ?? [])

  const happeningNow = computed(() =>
    entries.value.filter(e => isHappeningNow(e.start, e.end)),
  )

  const upcoming = computed(() =>
    entries.value
      .filter(e => parseFestivalDate(e.start).getTime() > Date.now())
      .sort((a, b) => parseFestivalDate(a.start).getTime() - parseFestivalDate(b.start).getTime()),
  )

  const past = computed(() =>
    entries.value
      .filter(e => parseFestivalDate(e.end).getTime() < Date.now() && !isHappeningNow(e.start, e.end))
      .sort((a, b) => parseFestivalDate(b.start).getTime() - parseFestivalDate(a.start).getTime()),
  )

  const bookmarked = computed(() =>
    entries.value.filter(e => isBookmarked(e.id)),
  )

  function getById(id: string): ScheduleEntry | undefined {
    return entries.value.find(e => e.id === id)
  }

  return { entries, happeningNow, upcoming, past, bookmarked, getById }
}
