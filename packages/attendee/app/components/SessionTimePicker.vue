<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
  bucketHours,
  minutesInHour,
  formatTimeLabel,
  formatDurationLabel,
} from '@festival/shared'
import PillButton from './ui/PillButton.vue'

function variantFor(hasValue: boolean, isActive: boolean) {
  if (hasValue) return 'filled' as const
  if (isActive) return 'active' as const
  return 'idle' as const
}

const props = defineProps<{
  startMinutesOfDay: number | null
  endMinutesOfDay: number | null
  /** Legal start slots (minutes-of-day, multiples of 15) for the chosen day. */
  validStartSlots: number[]
  /** Legal end slots (minutes-of-day, multiples of 15) for the chosen start. */
  validEndSlots: number[]
  /** Set true when no day is chosen yet. Both pills are disabled. */
  disabled?: boolean
  /** Display-only: show the chosen time but block all interaction (edit flow,
   * where session time is immutable on-chain). */
  readonly?: boolean
}>()

const emit = defineEmits<{
  'update:startMinutesOfDay': [value: number | null]
  'update:endMinutesOfDay': [value: number | null]
}>()

type Stage = null | 'from-hour' | 'from-minute' | 'to-hour' | 'to-minute'

const stage = ref<Stage>(null)
// Tentative hour bucket while inside the matching minute stage. Reset on Back
// or after committing the minute. Drives the two-line pill content.
const fromHourBucket = ref<number | null>(null)
const toHourBucket = ref<number | null>(null)

const fromHourBuckets = computed(() => bucketHours(props.validStartSlots))
const toHourBuckets = computed(() => bucketHours(props.validEndSlots))
const fromMinutesForBucket = computed(() =>
  fromHourBucket.value == null
    ? []
    : minutesInHour(props.validStartSlots, fromHourBucket.value),
)
const toMinutesForBucket = computed(() =>
  toHourBucket.value == null
    ? []
    : minutesInHour(props.validEndSlots, toHourBucket.value),
)

function openFrom() {
  if (props.disabled || props.readonly) return
  if (stage.value === 'from-hour' || stage.value === 'from-minute') {
    stage.value = null
    fromHourBucket.value = null
    return
  }
  stage.value = 'from-hour'
  fromHourBucket.value = null
}

function openTo() {
  if (props.disabled || props.readonly) return
  if (props.startMinutesOfDay == null) {
    stage.value = 'from-hour'
    return
  }
  if (stage.value === 'to-hour' || stage.value === 'to-minute') {
    stage.value = null
    toHourBucket.value = null
    return
  }
  stage.value = 'to-hour'
  toHourBucket.value = null
}

function pickFromHour(h: number) {
  fromHourBucket.value = h
  stage.value = 'from-minute'
}

function pickFromMinute(m: number) {
  if (fromHourBucket.value == null) return
  const slot = fromHourBucket.value * 60 + m
  emit('update:startMinutesOfDay', slot)
  // Clear an end that's no longer reachable. validEndSlots only updates on the
  // next tick, so use a conservative duration check instead of polling props.
  if (props.endMinutesOfDay != null) {
    const dur = props.endMinutesOfDay - slot
    if (dur < 15 || dur > 120) emit('update:endMinutesOfDay', null)
  }
  fromHourBucket.value = null
  stage.value = 'to-hour'
  toHourBucket.value = null
}

function pickToHour(h: number) {
  toHourBucket.value = h
  stage.value = 'to-minute'
}

function pickToMinute(m: number) {
  if (toHourBucket.value == null) return
  emit('update:endMinutesOfDay', toHourBucket.value * 60 + m)
  toHourBucket.value = null
  stage.value = null
}

function backToFromHour() {
  fromHourBucket.value = null
  stage.value = 'from-hour'
}

function backToToHour() {
  toHourBucket.value = null
  stage.value = 'to-hour'
}

// If validStartSlots changes and the chosen start is no longer valid, clear it.
watch(
  () => props.validStartSlots.join(','),
  () => {
    if (
      props.startMinutesOfDay != null &&
      !props.validStartSlots.includes(props.startMinutesOfDay)
    ) {
      emit('update:startMinutesOfDay', null)
      emit('update:endMinutesOfDay', null)
    }
  },
)

// If validEndSlots changes and the chosen end is no longer valid, clear it.
watch(
  () => props.validEndSlots.join(','),
  () => {
    if (
      props.endMinutesOfDay != null &&
      !props.validEndSlots.includes(props.endMinutesOfDay)
    ) {
      emit('update:endMinutesOfDay', null)
    }
  },
)

function formatHourPendingLabel(hour: number): string {
  return `${hour}:––`
}

const fromPillTwoLine = computed(
  () =>
    (stage.value === 'from-minute' && fromHourBucket.value != null) ||
    props.startMinutesOfDay != null,
)
const toPillTwoLine = computed(
  () =>
    (stage.value === 'to-minute' && toHourBucket.value != null) ||
    props.endMinutesOfDay != null,
)

const fromPillValueLabel = computed(() => {
  if (stage.value === 'from-minute' && fromHourBucket.value != null) {
    return formatHourPendingLabel(fromHourBucket.value)
  }
  if (props.startMinutesOfDay != null) {
    return formatTimeLabel(props.startMinutesOfDay)
  }
  return ''
})
const toPillValueLabel = computed(() => {
  if (stage.value === 'to-minute' && toHourBucket.value != null) {
    return formatHourPendingLabel(toHourBucket.value)
  }
  if (props.endMinutesOfDay != null) {
    return formatTimeLabel(props.endMinutesOfDay)
  }
  return ''
})

const showGrid = computed(() => stage.value !== null && !props.disabled && !props.readonly)

const durationMinutes = computed(() => {
  if (props.startMinutesOfDay == null || props.endMinutesOfDay == null) return null
  return props.endMinutesOfDay - props.startMinutesOfDay
})
const showDurationFooter = computed(
  () => stage.value === null && durationMinutes.value != null,
)
</script>

<template>
  <div data-testid="session-time-picker">
    <div class="flex items-center gap-3">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="currentColor"
        class="text-text-and-icons-primary shrink-0"
      >
        <path d="M12 2C6.5 2 2 6.5 2 12C2 17.5 6.5 22 12 22C17.5 22 22 17.5 22 12C22 6.5 17.5 2 12 2ZM15.55 15.8L11.47 13.29C11.17 13.11 10.99 12.79 10.99 12.44V7.75C11 7.34 11.34 7 11.75 7C12.16 7 12.5 7.34 12.5 7.75V12.2L16.34 14.51C16.7 14.73 16.82 15.2 16.6 15.56C16.38 15.91 15.91 16.02 15.55 15.8Z" />
      </svg>
      <span class="text-sm text-text-and-icons-primary">Session Time</span>

      <div class="flex items-center gap-2 ml-auto">
        <!-- From pill -->
        <PillButton
          data-testid="session-time-from-pill"
          :aria-pressed="stage === 'from-hour' || stage === 'from-minute'"
          :disabled="disabled || readonly"
          size="sm"
          :variant="variantFor(
            startMinutesOfDay != null,
            stage === 'from-hour' || stage === 'from-minute',
          )"
          @click="openFrom"
        >
          <template v-if="fromPillTwoLine">
            <span class="block text-[10px] leading-tight text-text-and-icons-tertiary">From</span>
            <span
              class="block leading-tight"
              :class="stage === 'from-minute' ? 'text-text-and-icons-secondary' : ''"
            >{{ fromPillValueLabel }}</span>
          </template>
          <template v-else>From</template>
        </PillButton>

        <!-- To pill -->
        <PillButton
          data-testid="session-time-to-pill"
          :aria-pressed="stage === 'to-hour' || stage === 'to-minute'"
          :disabled="disabled || readonly || startMinutesOfDay == null"
          size="sm"
          :variant="variantFor(
            endMinutesOfDay != null,
            stage === 'to-hour' || stage === 'to-minute',
          )"
          @click="openTo"
        >
          <template v-if="toPillTwoLine">
            <span class="block text-[10px] leading-tight text-text-and-icons-tertiary">To</span>
            <span
              class="block leading-tight"
              :class="stage === 'to-minute' ? 'text-text-and-icons-secondary' : ''"
            >{{ toPillValueLabel }}</span>
          </template>
          <template v-else>To</template>
        </PillButton>
      </div>
    </div>

    <!-- Stage legend -->
    <div
      v-if="showGrid"
      data-testid="session-time-stage-legend"
      class="mt-3 text-center text-sm leading-5 font-normal text-text-and-icons-secondary"
    >
      <p>{{ stage === 'from-minute' || stage === 'to-minute' ? 'Select Minutes' : 'Select Hours' }}</p>
      <hr class="mt-1 border-0 border-t border-stroke-primary" />
    </div>

    <!-- From: Hour grid -->
    <div
      v-if="showGrid && stage === 'from-hour'"
      data-testid="session-time-grid"
      class="mt-3 grid grid-cols-3 gap-2"
    >
      <PillButton
        v-for="h in fromHourBuckets"
        :key="`fh-${h}`"
        :data-testid="`session-time-from-hour-${h}`"
        @click="pickFromHour(h)"
      >
        {{ formatTimeLabel(h * 60) }}
      </PillButton>
      <p
        v-if="fromHourBuckets.length === 0"
        class="col-span-3 text-xs text-text-and-icons-tertiary text-center py-2"
        data-testid="session-time-grid-empty"
      >
        No available times.
      </p>
    </div>

    <!-- From: Minute grid -->
    <div
      v-if="showGrid && stage === 'from-minute'"
      data-testid="session-time-grid"
      class="mt-3 grid grid-cols-3 gap-2"
    >
      <PillButton
        variant="outlined"
        data-testid="session-time-back"
        @click="backToFromHour"
      >
        Back
      </PillButton>
      <PillButton
        v-for="m in fromMinutesForBucket"
        :key="`fm-${m}`"
        :data-testid="`session-time-from-minute-${fromHourBucket}-${m}`"
        @click="pickFromMinute(m)"
      >
        {{ formatTimeLabel((fromHourBucket ?? 0) * 60 + m) }}
      </PillButton>
    </div>

    <!-- To: Hour grid -->
    <div
      v-if="showGrid && stage === 'to-hour'"
      data-testid="session-time-grid"
      class="mt-3 grid grid-cols-3 gap-2"
    >
      <PillButton
        v-for="h in toHourBuckets"
        :key="`th-${h}`"
        :data-testid="`session-time-to-hour-${h}`"
        @click="pickToHour(h)"
      >
        {{ formatTimeLabel(h * 60) }}
      </PillButton>
      <p
        v-if="toHourBuckets.length === 0"
        class="col-span-3 text-xs text-text-and-icons-tertiary text-center py-2"
        data-testid="session-time-grid-empty"
      >
        No available times.
      </p>
    </div>

    <!-- To: Minute grid -->
    <div
      v-if="showGrid && stage === 'to-minute'"
      data-testid="session-time-grid"
      class="mt-3 grid grid-cols-3 gap-2"
    >
      <PillButton
        variant="outlined"
        data-testid="session-time-back"
        @click="backToToHour"
      >
        Back
      </PillButton>
      <PillButton
        v-for="m in toMinutesForBucket"
        :key="`tm-${m}`"
        :data-testid="`session-time-to-minute-${toHourBucket}-${m}`"
        @click="pickToMinute(m)"
      >
        {{ formatTimeLabel((toHourBucket ?? 0) * 60 + m) }}
      </PillButton>
    </div>

    <!-- Helper text -->
    <div class="mt-6 mb-6 text-center text-sm leading-5 font-normal text-text-and-icons-tertiary">
      <p
        v-if="showDurationFooter && durationMinutes != null"
        data-testid="session-time-duration"
      >
        Your Session Duration · {{ formatDurationLabel(durationMinutes) }}
      </p>
      <p v-else-if="!readonly">Sessions can run 15 min to 2 hours</p>
      <p>The time can't be changed after creation.</p>
      <hr class="mt-2 border-0 border-t border-stroke-primary" />
    </div>
  </div>
</template>
