import { computed } from 'vue'
import { formatTimeBerlin } from '@festival/shared/utils/time'
import { useBookmarks } from './useBookmarks'
import { useSchedule } from './useSchedule'
import { useSubEvents } from './useSubEvents'
import { useHiddenSessions } from './useHiddenSessions'
import { CATEGORY_STYLE, scheduleEntryCategory } from './useProgramTimeline'

export interface SavedItem {
  id: string
  title: string
  subtitle: string
  type: 'session' | 'sub-event'
  to: string
}

export function useSavedItems() {
  const { bookmarkedIds, isBookmarked } = useBookmarks()
  const schedule = useSchedule()
  const { subEvents } = useSubEvents()
  const { isHidden } = useHiddenSessions()

  const savedItems = computed<SavedItem[]>(() => {
    const items: SavedItem[] = []

    // Sub-events the user has favorited (and hasn't reported)
    for (const se of subEvents.value) {
      if (isBookmarked(se.address) && !isHidden(se.address)) {
        const time = formatTimeBerlin(new Date(se.startTime * 1000))
        items.push({
          id: se.address,
          title: se.metadata.name,
          subtitle: `Sub-event · ${time}`,
          type: 'sub-event',
          to: `/sessions/${se.address}`,
        })
      }
    }

    // Bookmarked schedule entries
    const ids = bookmarkedIds.value
    if (ids?.length) {
      for (const id of ids) {
        const entry = schedule.getById(id)
        if (entry) {
          const time = formatTimeBerlin(entry.start)
          items.push({
            id: entry.id,
            title: entry.title,
            subtitle: `${CATEGORY_STYLE[scheduleEntryCategory(entry)].label} · ${time}`,
            type: 'session',
            to: `/program/${entry.id}`,
          })
        }
      }
    }

    return items
  })

  return { savedItems }
}
