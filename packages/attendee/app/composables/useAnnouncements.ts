import { ref, computed, watch } from 'vue'
import { usePersistentRef } from '@festival/shared/cache/persistent'
import type { ChannelMetadata, AnnouncementBody } from '@festival/shared/metadata/schemas'
import { fetchAnnouncementBodies } from '@festival/shared/metadata/announcementBodies'
import { loadChannelFromChain } from '@festival/shared/metadata/channel'
import { readChannelMetadataCid } from '@festival/shared/contracts/festival-reads'
import { PREIMAGE_FETCH_CHUNK_SIZE } from '@festival/shared/host/constants'
import { FESTIVAL_ADDRESS } from '@festival/shared/contracts/addresses'
import { computeUnreadCount } from './announcementHighlight'

// UI window: how many announcements are visible before tapping "Load older".
// Aligned with the host's preimage fetch chunk so one page = one fetch burst.
const PAGE_SIZE = PREIMAGE_FETCH_CHUNK_SIZE

const channelId = FESTIVAL_ADDRESS.toLowerCase()

// Channel state
const channel = ref<ChannelMetadata | null>(null)
const channelCid = ref<`0x${string}` | null>(null)
const isLoading = ref(false)
const error = ref<string | null>(null)

// Per-user state (localStorage-backed). Tracks the last announcement the user
// has seen so we can compute unread counts; announcements themselves are
// delivered automatically once the user checks in.
const LAST_READ_KEY = `conferenceApp:lastReadCid:${channelId}`

// Durable across WebView eviction; write-through is automatic.
const lastReadCid = usePersistentRef<string | null>(LAST_READ_KEY, null)

// Computed
const announcements = computed<string[]>(() => channel.value?.announcements ?? [])

const unreadCount = computed(() =>
  computeUnreadCount(announcements.value, lastReadCid.value),
)

const latestUnreadCid = computed<string | null>(() => {
  if (unreadCount.value === 0) return null
  return announcements.value[announcements.value.length - 1] ?? null
})

// Reactive body cache, keyed by CID. `undefined` (key absent) = not yet
// fetched / in flight; `null` = fetch failed (render fallback); AnnouncementBody
// = loaded. AnnouncementCard reads this map instead of issuing its own fetch.
const bodies = ref<Map<string, AnnouncementBody | null>>(new Map())

// Newest-first window over `announcements`, growing by PAGE_SIZE on "Load older".
// New on-chain announcements prepend automatically as reload() updates the slice.
const visibleCount = ref(PAGE_SIZE)
const visibleCids = computed<string[]>(() =>
  [...announcements.value].reverse().slice(0, visibleCount.value),
)

async function ensureBodies(cids: string[]) {
  const missing = cids.filter((c) => !bodies.value.has(c))
  await fetchAnnouncementBodies(missing, (cid, body) => {
    bodies.value.set(cid, body)
  })
}

watch(visibleCids, (cids) => { void ensureBodies(cids) }, { immediate: true })

function loadOlder() {
  if (visibleCount.value >= announcements.value.length) return
  visibleCount.value = Math.min(visibleCount.value + PAGE_SIZE, announcements.value.length)
}

// Boot
let loadPromise: Promise<void> | null = null

async function loadChannel() {
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    isLoading.value = true
    error.value = null
    let failed = false
    try {
      const { cid, channel: doc } = await loadChannelFromChain(FESTIVAL_ADDRESS)
      channelCid.value = cid
      channel.value = doc
    } catch (e: any) {
      failed = true
      error.value = e?.message ?? String(e)
      console.error('[useAnnouncements] loadChannel failed:', e)
    } finally {
      isLoading.value = false
      // Release the memoized promise on failure so a follow-up call re-fetches
      // instead of returning the cached resolved promise.
      if (failed) loadPromise = null
    }
  })()
  return loadPromise
}

/** Force a re-fetch of the channel (e.g. after a contract event). */
async function reload() {
  loadPromise = null
  return loadChannel()
}

async function reloadIfChanged() {
  try {
    const headCid = await readChannelMetadataCid(FESTIVAL_ADDRESS)
    if (headCid.toLowerCase() === channelCid.value?.toLowerCase()) return
    await reload()
  } catch (e) {
    console.warn('[useAnnouncements] reloadIfChanged failed:', e)
  }
}

/** Mark the channel read up to (and including) the most recent announcement. */
function markRead() {
  const items = announcements.value
  if (items.length === 0) return
  const newest = items[items.length - 1]
  if (!newest) return
  lastReadCid.value = newest
}

export function useAnnouncements() {
  return {
    festivalAddress: FESTIVAL_ADDRESS,
    channelId,
    channel,
    channelCid,
    announcements,
    bodies,
    visibleCids,
    visibleCount,
    isLoading,
    error,
    unreadCount,
    latestUnreadCid,
    lastReadCid,
    loadChannel,
    reload,
    reloadIfChanged,
    loadOlder,
    markRead,
  }
}
