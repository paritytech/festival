<script setup lang="ts">
import { reactive, computed } from 'vue'
import type { ScheduleEntry, ScheduleEntryCategory, VenueMarker } from '@festival/shared/metadata/schemas'

const props = defineProps<{
  entry: ScheduleEntry
  markers: VenueMarker[]
  /** Min datetime-local for schedule bounds (e.g., festival start) */
  minDatetime?: string
  /** Max datetime-local for schedule bounds (e.g., festival end) */
  maxDatetime?: string
}>()

const emit = defineEmits<{
  save: [entry: ScheduleEntry]
  cancel: []
}>()

const form = reactive<ScheduleEntry>({
  ...props.entry,
  speakers: [...props.entry.speakers],
  // Fall back to 'official' so a saved entry always has a real category and we
  // never write undefined.
  category: props.entry.category ?? 'official',
})

const speakersText = computed({
  get: () => form.speakers.join(', '),
  set: (v: string) => { form.speakers = v.split(',').map(s => s.trim()).filter(Boolean) },
})

// 'official' by default. 'activations' is for things that run all day, and they
// don't show up in the announcement talks card.
const category = computed<ScheduleEntryCategory>({
  get: () => form.category ?? 'official',
  set: (v: ScheduleEntryCategory) => { form.category = v },
})

const isNew = computed(() => !props.entry.title)

function handleSubmit() {
  if (!form.title || !form.start || !form.end) return
  emit('save', { ...form, speakers: [...form.speakers] })
}
</script>

<template>
  <div class="bg-surface border border-border rounded-md p-5">
    <h3 class="font-medium mb-4">{{ isNew ? 'Add Schedule Entry' : 'Edit Schedule Entry' }}</h3>

    <div class="space-y-4">
      <div>
        <label class="block text-sm font-medium mb-1">Title *</label>
        <input
          v-model="form.title"
          type="text"
          class="w-full px-3 py-2 border border-border rounded-md text-sm bg-surface-elevated focus:outline-none focus:border-primary"
          placeholder="Opening Keynote"
        />
      </div>

      <div>
        <label class="block text-sm font-medium mb-1">Description</label>
        <textarea
          v-model="form.description"
          rows="2"
          class="w-full px-3 py-2 border border-border rounded-md text-sm bg-surface-elevated focus:outline-none focus:border-primary resize-none"
        />
      </div>

      <div>
        <label class="block text-sm font-medium mb-1">Category</label>
        <select
          v-model="category"
          data-testid="schedule-category-select"
          class="w-full px-3 py-2 border border-border rounded-md text-sm bg-surface-elevated"
        >
          <option value="official">Official</option>
          <option value="activations">Activations</option>
        </select>
      </div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label class="block text-sm font-medium mb-1">Start *</label>
          <input
            v-model="form.start"
            type="datetime-local"
            :min="minDatetime"
            :max="maxDatetime"
            class="w-full px-3 py-2 border border-border rounded-md text-sm bg-surface-elevated"
          />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">End *</label>
          <input
            v-model="form.end"
            type="datetime-local"
            :min="minDatetime"
            :max="maxDatetime"
            class="w-full px-3 py-2 border border-border rounded-md text-sm bg-surface-elevated"
          />
        </div>
      </div>

      <div>
        <label class="block text-sm font-medium mb-1">Location</label>
        <select
          v-model="form.venueMarkerId"
          class="w-full px-3 py-2 border border-border rounded-md text-sm bg-surface-elevated"
        >
          <option value="">None</option>
          <option v-for="m in markers" :key="m.id" :value="m.id">
            {{ m.label }} ({{ m.id }})
          </option>
        </select>
      </div>

      <div>
        <label class="block text-sm font-medium mb-1">Speakers</label>
        <input
          v-model="speakersText"
          type="text"
          class="w-full px-3 py-2 border border-border rounded-md text-sm bg-surface-elevated focus:outline-none focus:border-primary"
          placeholder="Alice, Bob (comma separated)"
        />
      </div>

      <div class="flex gap-2 pt-2">
        <button
          class="px-4 py-2 bg-primary text-black rounded-2xl text-sm hover:bg-primary-hover transition-colors disabled:opacity-50"
          :disabled="!form.title || !form.start || !form.end"
          @click="handleSubmit"
        >
          {{ isNew ? 'Add Entry' : 'Save Changes' }}
        </button>
        <button
          class="px-4 py-2 bg-secondary-btn rounded-2xl text-sm text-text-secondary hover:bg-secondary-btn-hover hover:text-text-primary transition-colors"
          @click="emit('cancel')"
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
</template>
