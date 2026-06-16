<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { FestivalDay } from '@festival/shared'
import PillButton from './ui/PillButton.vue'

const props = defineProps<{
  days: FestivalDay[]
  modelValue: string | null
  /** Berlin dateKeys the user can't pick (e.g. per-day session cap reached). */
  disabledDateKeys?: Set<string>
  /** Display-only: show the chosen day but block opening the picker (edit flow,
   * where session time is immutable on-chain). */
  readonly?: boolean
}>()

function isDisabled(dateKey: string): boolean {
  return props.disabledDateKeys?.has(dateKey) ?? false
}

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const expanded = ref(false)

const selectedDay = computed(() =>
  props.days.find((d) => d.dateKey === props.modelValue) ?? null,
)

function toggle() {
  if (props.readonly || props.days.length === 0) return
  expanded.value = !expanded.value
}

/** "Wednesday, 29 April" → "29 April". Strips the weekday prefix for the compact pill. */
function shortLabel(longLabel: string): string {
  const idx = longLabel.indexOf(',')
  return idx === -1 ? longLabel : longLabel.slice(idx + 1).trim()
}

function selectDay(dateKey: string) {
  if (isDisabled(dateKey)) return
  emit('update:modelValue', dateKey)
  expanded.value = false
}

// If the available days list shrinks (e.g. clock advanced past the chosen day),
// auto-clear stale selection so the parent re-prompts.
watch(
  () => props.days.map((d) => d.dateKey).join('|'),
  () => {
    if (
      props.modelValue &&
      !props.days.some((d) => d.dateKey === props.modelValue)
    ) {
      emit('update:modelValue', '')
    }
  },
)
</script>

<template>
  <div data-testid="session-date-picker">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="currentColor"
          class="text-text-and-icons-primary shrink-0"
        >
          <path d="M20 3H19V2C19 1.45 18.55 1 18 1C17.45 1 17 1.45 17 2V3H7V2C7 1.45 6.55 1 6 1C5.45 1 5 1.45 5 2V3H4C2.9 3 2 3.9 2 5V21C2 22.1 2.9 23 4 23H20C21.1 23 22 22.1 22 21V5C22 3.9 21.1 3 20 3ZM19 21H5C4.45 21 4 20.55 4 20V8H20V20C20 20.55 19.55 21 19 21Z" />
        </svg>
        <span class="text-sm text-text-and-icons-primary">Session Date</span>
      </div>
      <PillButton
        :data-testid="selectedDay ? 'session-date-pill' : 'session-date-add'"
        :aria-pressed="expanded"
        :disabled="days.length === 0 || readonly"
        size="md"
        tone="glass"
        :variant="selectedDay ? 'filled' : expanded ? 'active' : 'idle'"
        @click="toggle"
      >
        {{ selectedDay ? shortLabel(selectedDay.longLabel) : 'Add Date' }}
      </PillButton>
    </div>

    <div v-if="expanded" class="mt-3 space-y-2">
      <button
        v-for="day in days"
        :key="day.dateKey"
        type="button"
        :data-testid="`session-date-option-${day.dateKey}`"
        :disabled="isDisabled(day.dateKey)"
        :aria-disabled="isDisabled(day.dateKey)"
        class="w-full flex items-center justify-between p-4 rounded-xl text-sm font-medium transition-colors bg-surface-2 text-text-and-icons-primary disabled:opacity-40 disabled:cursor-not-allowed"
        @click="selectDay(day.dateKey)"
      >
        <span>{{ day.label }}</span>
        <span>{{ day.longLabel }}</span>
      </button>
    </div>

    <p
      v-if="days.length === 0"
      class="mt-3 text-xs text-white/40"
      data-testid="session-date-empty"
    >
      No upcoming festival days available.
    </p>
  </div>
</template>
