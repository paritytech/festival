<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { isHappeningNow, timeUntil, formatTimeBerlin, parseFestivalDate } from '@festival/shared/utils/time'
import type { ScheduleEntry } from '@festival/shared/metadata/schemas'
import { getMarkerLocationLabel } from '@festival/shared/venue/floors'
import { useFestival } from '~/composables/useFestival'

const props = defineProps<{
  schedule: ScheduleEntry[]
}>()

const { metadata } = useFestival()
const venueMarkers = computed(() => metadata.value?.venueMap?.markers ?? [])

const ROTATE_INTERVAL = 5000 // 5 seconds per card
const PAUSE_DURATION = 15000 // 15s pause after manual interaction
const NOW_CHECK_INTERVAL = 30000 // re-check "now" every 30s

// Current time ref that updates periodically for reactivity
const now = ref(Date.now())
let nowTimer: ReturnType<typeof setInterval>

// What's happening right now
const liveEntries = computed(() =>
  props.schedule.filter(e => isHappeningNow(e.start, e.end))
)

// Next upcoming (sorted by soonest start)
const nextUp = computed(() => {
  const upcoming = props.schedule
    .filter(e => parseFestivalDate(e.start).getTime() > now.value)
    .sort((a, b) => parseFestivalDate(a.start).getTime() - parseFestivalDate(b.start).getTime())
  return upcoming[0] || null
})

// What to show: live entries if any, otherwise the single next-up
const spotlightEntries = computed(() => {
  if (liveEntries.value.length > 0) return liveEntries.value
  if (nextUp.value) return [nextUp.value]
  return []
})

const isLive = computed(() => liveEntries.value.length > 0)
const totalCards = computed(() => spotlightEntries.value.length)
const currentIndex = ref(0)
const currentEntry = computed(() => spotlightEntries.value[currentIndex.value] || null)

// Progress bar (0 to 1 over ROTATE_INTERVAL)
const progress = ref(0)
let progressStart = 0
let progressFrame: number | null = null

// Auto-rotation
let rotateTimer: ReturnType<typeof setInterval> | null = null
let pauseTimer: ReturnType<typeof setTimeout> | null = null
const isPaused = ref(false)

function startProgress() {
  progressStart = Date.now()
  progress.value = 0
  if (progressFrame) cancelAnimationFrame(progressFrame)

  function tick() {
    const elapsed = Date.now() - progressStart
    progress.value = Math.min(elapsed / ROTATE_INTERVAL, 1)
    if (progress.value < 1) {
      progressFrame = requestAnimationFrame(tick)
    }
  }
  progressFrame = requestAnimationFrame(tick)
}

function stopProgress() {
  if (progressFrame) {
    cancelAnimationFrame(progressFrame)
    progressFrame = null
  }
  progress.value = 0
}

function advance() {
  if (totalCards.value <= 1) return
  currentIndex.value = (currentIndex.value + 1) % totalCards.value
  startProgress()
}

function startRotation() {
  stopRotation()
  if (totalCards.value <= 1) return
  startProgress()
  rotateTimer = setInterval(advance, ROTATE_INTERVAL)
}

function stopRotation() {
  if (rotateTimer) { clearInterval(rotateTimer); rotateTimer = null }
  stopProgress()
}

function pauseRotation() {
  isPaused.value = true
  stopRotation()
  if (pauseTimer) clearTimeout(pauseTimer)
  pauseTimer = setTimeout(() => {
    isPaused.value = false
    startRotation()
  }, PAUSE_DURATION)
}

// Swipe detection
let touchStartX = 0
let touchStartTime = 0

function handleTouchStart(e: TouchEvent) {
  touchStartX = e.touches[0].clientX
  touchStartTime = Date.now()
}

function handleTouchEnd(e: TouchEvent) {
  const dx = e.changedTouches[0].clientX - touchStartX
  const dt = Date.now() - touchStartTime
  if (Math.abs(dx) > 40 && dt < 500) {
    // Swipe detected
    pauseRotation()
    if (dx < 0) {
      // Swipe left → next
      currentIndex.value = (currentIndex.value + 1) % totalCards.value
    } else {
      // Swipe right → previous
      currentIndex.value = (currentIndex.value - 1 + totalCards.value) % totalCards.value
    }
  }
}

function handleClick() {
  if (totalCards.value > 1) pauseRotation()
}

// Countdown text for upcoming sessions
function getCountdown(entry: ScheduleEntry): string {
  const diff = parseFestivalDate(entry.start).getTime() - now.value
  if (diff <= 0) return ''
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Starting now'
  if (mins < 60) return `Starts in ${mins} min`
  const hours = Math.floor(mins / 60)
  return `Starts in ${hours}h ${mins % 60}m`
}

function formatTime(iso: string) {
  return formatTimeBerlin(iso)
}

// Lifecycle
onMounted(() => {
  nowTimer = setInterval(() => { now.value = Date.now() }, NOW_CHECK_INTERVAL)
  startRotation()
})

onUnmounted(() => {
  clearInterval(nowTimer)
  stopRotation()
  if (pauseTimer) clearTimeout(pauseTimer)
})

// Restart rotation when entries change
watch(totalCards, () => {
  currentIndex.value = 0
  if (totalCards.value > 1 && !isPaused.value) startRotation()
  else stopRotation()
})
</script>

<template>
  <div v-if="currentEntry" class="mb-5">
    <NuxtLink
      :to="`/program/${currentEntry.id}`"
      class="block bg-surface border rounded-lg overflow-hidden"
      :class="isLive ? 'border-primary/30 bg-primary-light/30' : 'border-border'"
      @click="handleClick"
      @touchstart.passive="handleTouchStart"
      @touchend.passive="handleTouchEnd"
    >
      <!-- Progress bar (only when multiple and live) -->
      <div v-if="totalCards > 1" class="h-0.5 bg-border/50">
        <div
          class="h-full bg-primary/40 transition-none"
          :style="{ width: `${progress * 100}%` }"
        />
      </div>

      <div class="p-4">
        <!-- Status line -->
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <span v-if="isLive" class="flex items-center gap-1.5">
              <span class="w-2 h-2 bg-primary rounded-full animate-pulse" />
              <span class="text-xs font-medium text-primary uppercase tracking-wide">Live</span>
            </span>
            <span v-else class="text-xs font-medium text-text-muted">
              {{ getCountdown(currentEntry) }}
            </span>
          </div>
          <div v-if="totalCards > 1" class="flex items-center gap-1">
            <span class="text-[10px] text-text-muted">{{ currentIndex + 1 }}/{{ totalCards }}</span>
          </div>
        </div>

        <!-- Title -->
        <h3 class="font-heading text-lg font-bold leading-snug mb-1">{{ currentEntry.title }}</h3>

        <!-- Meta row -->
        <div class="flex items-center flex-wrap gap-x-3 gap-y-1 text-sm text-text-secondary">
          <span v-if="currentEntry.speakers?.length">
            {{ currentEntry.speakers.join(', ') }}
          </span>
          <span class="text-xs text-text-muted">
            {{ formatTime(currentEntry.start) }}–{{ formatTime(currentEntry.end) }}
          </span>
        </div>

        <!-- Location link -->
        <div v-if="currentEntry.venueMarkerId" class="mt-2">
          <span class="text-xs text-primary">
            📍 {{ getMarkerLocationLabel(currentEntry.venueMarkerId!, venueMarkers) }}
          </span>
        </div>

        <!-- Category -->
        <div class="mt-2">
          <span
            class="text-[10px] px-2 py-0.5 rounded-full font-medium bg-primary/10 text-primary"
          >
            Official
          </span>
        </div>
      </div>
    </NuxtLink>

    <!-- Swipe hint (shows briefly when multiple) -->
    <p v-if="totalCards > 1 && !isPaused" class="text-[10px] text-text-muted text-center mt-1">
      {{ totalCards }} sessions now · swipe to browse
    </p>
  </div>
</template>
