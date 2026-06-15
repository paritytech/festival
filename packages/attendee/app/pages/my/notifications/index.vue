<script setup lang="ts">
import {
  computed,
  onActivated,
  onDeactivated,
  onUnmounted,
  ref,
  watch,
  type WatchStopHandle,
} from 'vue'
import { useAnnouncements } from '~/composables/useAnnouncements'
import { snapshotUnreadCids, newCidsSince } from '~/composables/announcementHighlight'

const router = useRouter()
const {
  channel,
  announcements,
  visibleCids,
  visibleCount,
  isLoading,
  lastReadCid,
  loadChannel,
  loadOlder,
  markRead,
} = useAnnouncements()

const hasOlder = computed(() => visibleCount.value < announcements.value.length)

const HIGHLIGHT_DURATION_MS = 5000

const highlightedCids = ref<Set<string>>(new Set())

let stopWatch: WatchStopHandle | null = null
let highlightTimer: ReturnType<typeof setTimeout> | null = null
let active = false

function armHighlightTimer() {
  if (highlightTimer) clearTimeout(highlightTimer)
  highlightTimer = setTimeout(() => {
    highlightedCids.value = new Set()
    highlightTimer = null
  }, HIGHLIGHT_DURATION_MS)
}

function startSession() {
  if (stopWatch) return
  const seen = new Set<string>(announcements.value)

  const unread = snapshotUnreadCids(announcements.value, lastReadCid.value)
  if (unread.length > 0) {
    highlightedCids.value = new Set(unread)
    armHighlightTimer()
    markRead()
  }

  stopWatch = watch(announcements, (items) => {
    const fresh = newCidsSince(items, seen)
    for (const cid of fresh) seen.add(cid)
    if (fresh.length === 0) return
    const next = new Set(highlightedCids.value)
    for (const cid of fresh) next.add(cid)
    highlightedCids.value = next
    armHighlightTimer()
    markRead()
  })
}

function stopSession() {
  stopWatch?.()
  stopWatch = null
  if (highlightTimer) {
    clearTimeout(highlightTimer)
    highlightTimer = null
  }
  highlightedCids.value = new Set()
}

onActivated(async () => {
  active = true
  await loadChannel()
  if (!active) return
  startSession()
})

function teardown() {
  active = false
  stopSession()
}

onDeactivated(teardown)
onUnmounted(teardown)
</script>

<template>
  <div class="-mx-4 flex flex-col min-h-[calc(100dvh-52px-var(--safe-bottom))] md:min-h-[100dvh]">
    <!-- Header -->
    <div class="px-4 pt-4 pb-3 flex items-center shrink-0">
      <BackButton class="text-text-and-icons-primary" @click="router.push('/')" />
      <h1 class="flex-1 text-center text-base font-semibold text-text-and-icons-primary" data-testid="notifications-heading">Announcements</h1>
      <div class="w-10" />
    </div>

    <div v-if="isLoading && !channel" class="flex-1 flex items-center justify-center py-12">
      <div class="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
    </div>

    <div v-else-if="!channel" class="px-4 py-12 text-center">
      <p class="text-text-muted text-sm">No channel for this festival.</p>
    </div>

    <!-- No announcements yet: reassuring empty state. -->
    <div
      v-else-if="announcements.length === 0"
      class="flex-1 flex flex-col items-center justify-center text-center px-4 pb-6"
      data-testid="announcements-empty-state"
    >
      <img src="/bell-empty.svg" alt="" width="108" height="108" />
      <p class="text-text-secondary text-sm mt-6 max-w-[300px] leading-snug">
        You're all set. Announcements from organizers will appear here.
      </p>
    </div>

    <template v-else>
      <!-- Feed. Renders only the visible window; ensureBodies(visibleCids)
           in useAnnouncements keeps the body cache warm in lockstep. -->
      <div class="mx-4 space-y-3">
        <AnnouncementCard
          v-for="cid in visibleCids"
          :key="cid"
          :cid="cid"
          :highlight="highlightedCids.has(cid)"
        />
      </div>
      <div v-if="hasOlder" class="mx-4 mt-3 pb-6">
        <button
          type="button"
          class="w-full rounded-2xl bg-surface-2 text-text-secondary text-sm font-medium py-3 cursor-pointer hover:bg-surface-3 transition-colors"
          data-testid="announcements-load-older"
          @click="loadOlder"
        >
          Load older
        </button>
      </div>
    </template>
  </div>
</template>
