import { ref, computed } from 'vue'
import type { ScheduleEntry } from '@festival/shared/metadata/schemas'
import { parseFestivalDate } from '@festival/shared/utils/time'

let idCounter = 100

function generateId(): string {
  return `entry-${Date.now()}-${idCounter++}`
}

/**
 * Add / edit / remove / reorder schedule entries over a live entries array.
 *
 * The array is mutated in place (never reassigned) so it stays the same
 * reactive reference the caller's change-tracking observes — e.g. the festival
 * draft's deep watcher, which drives dirty state and publish-conflict detection.
 */
export function useScheduleEditor(entries: ScheduleEntry[]) {
  const editingEntry = ref<ScheduleEntry | null>(null)
  const showForm = ref(false)

  const sorted = computed(() =>
    [...entries].sort((a, b) => parseFestivalDate(a.start).getTime() - parseFestivalDate(b.start).getTime()),
  )

  function openAdd() {
    editingEntry.value = {
      id: generateId(),
      start: '', end: '', title: '', description: '', speakers: [],
    }
    showForm.value = true
  }

  function openEdit(entry: ScheduleEntry) {
    editingEntry.value = { ...entry, speakers: [...entry.speakers] }
    showForm.value = true
  }

  function saveEntry(entry: ScheduleEntry) {
    const idx = entries.findIndex(e => e.id === entry.id)
    if (idx >= 0) entries[idx] = { ...entry }
    else entries.push({ ...entry })
    cancelEdit()
  }

  function removeEntry(id: string) {
    const idx = entries.findIndex(e => e.id === id)
    if (idx >= 0) entries.splice(idx, 1)
  }

  function moveUp(id: string) {
    const idx = entries.findIndex(e => e.id === id)
    if (idx > 0) [entries[idx - 1], entries[idx]] = [entries[idx], entries[idx - 1]]
  }

  function moveDown(id: string) {
    const idx = entries.findIndex(e => e.id === id)
    if (idx >= 0 && idx < entries.length - 1) [entries[idx], entries[idx + 1]] = [entries[idx + 1], entries[idx]]
  }

  function cancelEdit() {
    showForm.value = false
    editingEntry.value = null
  }

  return {
    sorted,
    editingEntry,
    showForm,
    openAdd,
    openEdit,
    saveEntry,
    removeEntry,
    moveUp,
    moveDown,
    cancelEdit,
  }
}
