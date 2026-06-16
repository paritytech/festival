<script setup lang="ts">
import { ref, computed } from 'vue'
import { useFestivalContext } from '~/composables/useFestivalContext'
import { useFestival } from '~/composables/useFestival'
import { usePermissions } from '~/composables/usePermissions'
import type { ScheduleEntry } from '@festival/shared/metadata/schemas'
import { getMarkerLabel } from '@festival/shared/venue/floors'
import { timestampToInputBounds, formatTimeBerlin, parseFestivalDate } from '@festival/shared/utils/time'

definePageMeta({ layout: 'festival' })

const { draft, userRoles, scheduleEntryStatus, address: festivalAddress } = useFestivalContext()
const { details: festivalDetails } = useFestival(festivalAddress)

const festivalBounds = computed(() => {
  if (!festivalDetails.value || festivalDetails.value.startTime === 0n) return null
  return {
    start: timestampToInputBounds(festivalDetails.value.startTime),
    end: timestampToInputBounds(festivalDetails.value.endTime),
  }
})
const { canEditMetadata } = usePermissions(userRoles)

const editingEntry = ref<ScheduleEntry | null>(null)
const showForm = ref(false)
let idCounter = 100

const sorted = computed(() =>
  [...draft.schedule].sort((a, b) => parseFestivalDate(a.start).getTime() - parseFestivalDate(b.start).getTime()),
)

const markers = computed(() => draft.venueMap?.markers || [])

function formatTime(iso: string) {
  if (!iso) return '—'
  return formatTimeBerlin(iso)
}

function openAdd() {
  editingEntry.value = {
    id: `entry-${Date.now()}-${idCounter++}`,
    start: '', end: '', title: '', description: '', speakers: [],
  }
  showForm.value = true
}

function openEdit(entry: ScheduleEntry) {
  editingEntry.value = { ...entry, speakers: [...entry.speakers] }
  showForm.value = true
}

function saveEntry(entry: ScheduleEntry) {
  const idx = draft.schedule.findIndex(e => e.id === entry.id)
  if (idx >= 0) {
    draft.schedule[idx] = { ...entry }
  } else {
    draft.schedule.push({ ...entry })
  }
  showForm.value = false
  editingEntry.value = null
}

function removeEntry(id: string) {
  const idx = draft.schedule.findIndex(e => e.id === id)
  if (idx >= 0) draft.schedule.splice(idx, 1)
}

function moveUp(id: string) {
  const idx = draft.schedule.findIndex(e => e.id === id)
  if (idx > 0) {
    const temp = draft.schedule[idx]
    draft.schedule[idx] = draft.schedule[idx - 1]
    draft.schedule[idx - 1] = temp
  }
}

function moveDown(id: string) {
  const idx = draft.schedule.findIndex(e => e.id === id)
  if (idx < draft.schedule.length - 1) {
    const temp = draft.schedule[idx]
    draft.schedule[idx] = draft.schedule[idx + 1]
    draft.schedule[idx + 1] = temp
  }
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h2 class="font-heading text-2xl font-bold" data-testid="schedule-heading">Schedule</h2>
      <button
        v-if="canEditMetadata"
        data-testid="schedule-add-btn"
        class="px-4 py-2 bg-primary text-black rounded-2xl text-sm hover:bg-primary-hover transition-colors"
        @click="openAdd"
      >
        Add Entry
      </button>
    </div>

    <!-- Entry form -->
    <div v-if="showForm && editingEntry" class="mb-6">
      <ScheduleEntryForm
        :entry="editingEntry"
        :markers="markers"
        :min-datetime="festivalBounds?.start.datetimeLocal"
        :max-datetime="festivalBounds?.end.datetimeLocal"
        @save="saveEntry"
        @cancel="() => { showForm = false; editingEntry = null }"
      />
    </div>

    <!-- Entry list -->
    <div class="space-y-2">
      <div
        v-for="(entry, idx) in sorted"
        :key="entry.id"
        class="bg-surface border rounded-xl p-4"
        :class="{
          'border-success/30 bg-success-muted': scheduleEntryStatus(entry.id) === 'new',
          'border-warning/30 bg-warning-muted': scheduleEntryStatus(entry.id) === 'modified',
          'border-border': scheduleEntryStatus(entry.id) === 'unchanged',
        }"
      >
        <!-- Desktop: single row -->
        <div class="hidden sm:flex items-start gap-4">
          <div v-if="canEditMetadata" class="flex flex-col gap-0.5 shrink-0 pt-1">
            <button class="text-text-muted hover:text-text-primary text-xs leading-none disabled:opacity-30" :disabled="idx === 0" @click="moveUp(entry.id)">▲</button>
            <button class="text-text-muted hover:text-text-primary text-xs leading-none disabled:opacity-30" :disabled="idx === sorted.length - 1" @click="moveDown(entry.id)">▼</button>
          </div>
          <div class="text-xs text-text-muted w-24 shrink-0 pt-0.5">
            <p>{{ formatTime(entry.start) }}</p>
            <p>{{ formatTime(entry.end) }}</p>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <h4 class="font-medium text-sm">{{ entry.title }}</h4>
              <span v-if="entry.category === 'activations'" class="text-[10px] px-1.5 py-0.5 rounded font-medium" :style="{ backgroundColor: '#FFB300', color: '#000000' }">Activations</span>
              <span v-if="scheduleEntryStatus(entry.id) === 'new'" class="text-[10px] px-1.5 py-0.5 rounded bg-success/12 text-success font-medium">New</span>
              <span v-else-if="scheduleEntryStatus(entry.id) === 'modified'" class="text-[10px] px-1.5 py-0.5 rounded bg-warning/12 text-warning font-medium">Edited</span>
            </div>
            <p v-if="entry.description" class="text-xs text-text-secondary line-clamp-1">{{ entry.description }}</p>
            <div class="flex items-center gap-3 mt-1 text-xs text-text-muted">
              <span v-if="entry.speakers.length">{{ entry.speakers.join(', ') }}</span>
              <span v-if="entry.venueMarkerId" class="font-mono">📍 {{ getMarkerLabel(entry.venueMarkerId, markers) }}</span>
            </div>
          </div>
          <div v-if="canEditMetadata" class="flex gap-1 shrink-0">
            <button class="px-2 py-1 text-xs text-text-muted hover:text-text-primary transition-colors" @click="openEdit(entry)">Edit</button>
            <button class="px-2 py-1 text-xs text-danger hover:text-danger/80 transition-colors" @click="removeEntry(entry.id)">Remove</button>
          </div>
        </div>

        <!-- Mobile: stacked -->
        <div class="sm:hidden space-y-2">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="text-xs text-text-muted">{{ formatTime(entry.start) }} – {{ formatTime(entry.end) }}</span>
              <span v-if="entry.category === 'activations'" class="text-[10px] px-1.5 py-0.5 rounded font-medium" :style="{ backgroundColor: '#FFB300', color: '#000000' }">Activations</span>
              <span v-if="scheduleEntryStatus(entry.id) === 'new'" class="text-[10px] px-1.5 py-0.5 rounded bg-success/12 text-success font-medium">New</span>
              <span v-else-if="scheduleEntryStatus(entry.id) === 'modified'" class="text-[10px] px-1.5 py-0.5 rounded bg-warning/12 text-warning font-medium">Edited</span>
            </div>
          </div>
          <h4 class="font-medium text-sm">{{ entry.title }}</h4>
          <p v-if="entry.description" class="text-xs text-text-secondary line-clamp-2">{{ entry.description }}</p>
          <div class="flex items-center gap-3 text-xs text-text-muted">
            <span v-if="entry.speakers.length">{{ entry.speakers.join(', ') }}</span>
            <span v-if="entry.venueMarkerId">📍 {{ getMarkerLabel(entry.venueMarkerId, markers) }}</span>
          </div>
          <div v-if="canEditMetadata" class="flex items-center gap-3 pt-1 border-t border-border">
            <div class="flex gap-1">
              <button class="text-text-muted hover:text-text-primary text-xs disabled:opacity-30" :disabled="idx === 0" @click="moveUp(entry.id)">▲</button>
              <button class="text-text-muted hover:text-text-primary text-xs disabled:opacity-30" :disabled="idx === sorted.length - 1" @click="moveDown(entry.id)">▼</button>
            </div>
            <button class="text-xs text-text-muted hover:text-text-primary" @click="openEdit(entry)">Edit</button>
            <button class="text-xs text-danger hover:text-danger/80" @click="removeEntry(entry.id)">Remove</button>
          </div>
        </div>
      </div>
    </div>

    <p v-if="!sorted.length" class="text-center text-text-muted text-sm py-8">No schedule entries yet. Click "Add Entry" to get started.</p>
    <p v-else class="text-xs text-text-muted mt-4">{{ sorted.length }} entries · changes publish from the sidebar</p>
  </div>
</template>
