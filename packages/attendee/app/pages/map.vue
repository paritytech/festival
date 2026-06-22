<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { VenueMarker } from '@festival/shared/metadata/schemas'
import {
  getFloor,
  getMapContextLabel,
  formatChipFromMarker,
  isOutdoorFloor,
  VENUE_OUTDOOR_FLOOR,
  VENUE_BLOCKS,
} from '@festival/shared/venue/floors'
import { useAttendeeMap } from '~/composables/useAttendeeMap'
import FloorControl from '~/components/FloorControl.vue'
import VenueMap from '~/components/VenueMap.vue'
import MapSelectedCard from '~/components/MapSelectedCard.vue'
import MapSessionStrip from '~/components/MapSessionStrip.vue'

const route = useRoute()
const router = useRouter()

const {
  mode,
  markers,
  zones,
  activeFloorId,
  activeBlock,
  selectedMarkerId,
  selectedMarker,
  markersReady,
  userSpot,
  select,
  clearSelection,
  placeSpot,
  removeSpot,
  enterBuilding,
  exitToOutdoor,
  switchFloor,
  getSessionStripFor,
} = useAttendeeMap()

const selectableFloors = computed(() => {
  const block = activeBlock.value ?? VENUE_BLOCKS[0]
  return [VENUE_OUTDOOR_FLOOR, ...(block?.floors ?? [])]
})

const mapRef = ref<InstanceType<typeof VenueMap> | null>(null)
const toast = ref<string | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | null = null

// Locked while the enter/exit choreography runs. All gestures short-circuit on
// it, otherwise the engine's programmatic pan/zoom retriggers handlers mid-animation.
const transitioning = ref(false)
const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// Desktop (md+) has no bottom nav, so the map owns the full height. On mobile,
// reserve the tab bar (52px) + iOS safe-area inset so the fit clears the nav.
const bottomNavHeight = ref(0)
function measureBottomNavHeight() {
  if (typeof document === 'undefined') return
  const isDesktop = window.matchMedia('(min-width: 768px)').matches
  if (isDesktop) {
    bottomNavHeight.value = 0
    return
  }
  const probe = document.createElement('div')
  probe.style.cssText = 'position: fixed; bottom: 0; left: 0; padding-bottom: var(--safe-bottom); visibility: hidden; pointer-events: none;'
  document.body.appendChild(probe)
  const safeBottom = parseFloat(getComputedStyle(probe).paddingBottom) || 0
  document.body.removeChild(probe)
  bottomNavHeight.value = 52 + safeBottom
}

const isIndoor = computed(() => mode.value === 'indoor')

// Headline + sub-label for the bottom selected-card. Marker selected →
// "marker name" + "Floor · Zone". User-dropped pin → "Pinned location" + Floor.
const selectedChip = computed(() => {
  // Marker → "marker name" + "Floor · Zone". formatChipFromMarker falls back to
  // the type label for icon-only markers that save with an empty label.
  if (selectedMarker.value) {
    return formatChipFromMarker(selectedMarker.value, zones.value)
  }
  if (userSpot.value) {
    return {
      headline: 'Pinned location',
      sub: getMapContextLabel(userSpot.value.floorId),
    }
  }
  return { headline: '', sub: '' }
})

const sessionStrip = computed(() => {
  if (!selectedMarker.value) return null
  return getSessionStripFor(selectedMarker.value.id)
})

const hasSelection = computed(() => !!selectedMarker.value || !!userSpot.value)

// ── Interactions ──
/**
 * Outdoor → indoor choreography (~1.3s).
 *   T=0     flyToBuildingBounds toward the main-building footprint
 *   T=350   flash fades in (450ms)
 *   T=800   silent floor swap (mode flip → ground floor) under full flash
 *   T=800   flash fades out (400ms)
 *   T=1300  unlock input
 */
async function playEnterChoreography(targetFloorId?: string) {
  const map = mapRef.value
  if (!map) return
  transitioning.value = true
  map.setTransitioning(true)

  // Fire-and-forget; the flash overlaps the tail of this pan/zoom.
  void map.flyToBuildingBounds({ duration: 0.5, maxZoomDelta: 2.5 })

  await delay(350)
  void map.fadeFlash('in', 450)

  await delay(450)
  // Flip mode under cover of the opaque flash; VenueMap's activeFloorId watcher
  // drives the engine's setFloor.
  enterBuilding(targetFloorId)

  await delay(50)
  void map.fadeFlash('out', 400)

  await delay(450)
  transitioning.value = false
  map.setTransitioning(false)
}

/**
 * Indoor → outdoor choreography (~900ms). No "approach" phase since the user
 * is leaving the building.
 *   T=0     flash fades in (350ms)
 *   T=450   silent floor swap (mode flip → venue overhead)
 *   T=500   flash fades out (400ms)
 *   T=900   unlock input
 */
async function playExitChoreography() {
  const map = mapRef.value
  if (!map) return
  transitioning.value = true
  map.setTransitioning(true)

  void map.fadeFlash('in', 350)

  await delay(450)
  exitToOutdoor()

  await delay(50)
  void map.fadeFlash('out', 400)

  await delay(400)
  transitioning.value = false
  map.setTransitioning(false)
}

function handleBuildingClick() {
  if (transitioning.value) return
  void playEnterChoreography()
}

function handleFloorControlChange(floorId: string) {
  if (transitioning.value) return
  if (floorId === activeFloorId.value) return
  const targetIsOutdoor = isOutdoorFloor(floorId)
  if (mode.value === 'outdoor' && !targetIsOutdoor) {
    void playEnterChoreography(floorId)
  } else if (mode.value === 'indoor' && targetIsOutdoor) {
    void playExitChoreography()
  } else {
    switchFloor(floorId)
  }
}


/** Arm the pinch-out / wheel-out gesture as the indoor exit. The engine fires
 *  the trigger once past `fitZoom - belowFitBy * 0.5` and self-disarms. */
function armExitGesture() {
  mapRef.value?.enableZoomOutGesture({
    belowFitBy: 0.7,
    onTrigger: () => {
      // Skip mid-choreography; the reconciler re-arms once transitioning settles.
      if (transitioning.value) {
        nextTick(() => reconcileExitGesture())
        return
      }
      void playExitChoreography()
    },
  })
}

/** Arm the exit gesture only when indoor with no choreography in flight. Runs
 *  on every change of `mode`/`transitioning` and on initial engine ready. */
function reconcileExitGesture() {
  if (!mapRef.value) return
  if (transitioning.value) return
  if (mode.value === 'indoor') armExitGesture()
  else mapRef.value.disableZoomOutGesture()
}

watch([mode, transitioning], () => {
  reconcileExitGesture()
})

function handleMarkerClick(marker: VenueMarker) {
  if (transitioning.value) return
  select(marker)
  nextTick(() => mapRef.value?.focusMarker(marker.id, { bottomPadding: 220 }))
}

function handleMapClick(loc: { x: number; y: number; floorId: string }) {
  if (transitioning.value) return
  // A tap with an open card dismisses it; the next tap places a pin.
  if (hasSelection.value) {
    handleClose()
    return
  }
  placeSpot(loc.x, loc.y, loc.floorId)
  nextTick(() => mapRef.value?.focusSpot({ x: loc.x, y: loc.y, floorId: loc.floorId }, { bottomPadding: 220 }))
}

/** Void (outside floor) taps still dismiss an open card. */
function handleVoidClick() {
  if (transitioning.value) return
  if (hasSelection.value) handleClose()
}

function handleClose() {
  if (userSpot.value) removeSpot()
  else clearSelection()
}

function openSession() {
  const strip = sessionStrip.value
  if (strip) router.push(strip.route)
}

// ── Share ──
function showToast(msg: string) {
  toast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = null }, 2000)
}

async function handleShare() {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  let text: string
  let url: string

  if (selectedMarker.value) {
    const m = selectedMarker.value
    text = `${m.label} — ${selectedChip.value.sub}`
    url = `${origin}/#${router.resolve({ path: '/map', query: { marker: m.id } }).fullPath}`
  } else if (userSpot.value) {
    const s = userSpot.value
    text = `Meet me here — ${selectedChip.value.sub}`
    url = `${origin}/#${router.resolve({ path: '/map', query: { spot: `${s.floorId}:${s.x}:${s.y}` } }).fullPath}`
  } else {
    return
  }

  if (typeof navigator !== 'undefined' && navigator.share) {
    try { await navigator.share({ text, url }); return }
    catch { /* fall through */ }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`)
    showToast('Link copied to clipboard')
  } catch {
    showToast('Could not copy link')
  }
}

// ── URL sync ──
let initialRestoreDone = false

async function handleEngineReady() {
  // onReady fires after every floor swap (including the ones our own
  // choreography triggers). Only consume the first one for URL hydration.
  if (initialRestoreDone) return
  initialRestoreDone = true
  maybeArmOnReady()
  await restoreFromQuery()
}

async function restoreFromQuery() {
  const markerQuery = route.query.marker as string | undefined
  if (markerQuery) {
    const m = markers.value.find(x => x.id === markerQuery)
    if (m) {
      if (isOutdoorFloor(m.floorId)) {
        select(m)
      } else {
        await playEnterChoreography(m.floorId)
        select(m)
      }
      nextTick(() => mapRef.value?.focusMarker(m.id, { bottomPadding: 220 }))
      return
    }
  }
  const spotQuery = route.query.spot as string | undefined
  if (spotQuery) {
    const [floorId, xStr, yStr] = spotQuery.split(':')
    const x = parseInt(xStr ?? '', 10)
    const y = parseInt(yStr ?? '', 10)
    if (!floorId || !Number.isFinite(x) || !Number.isFinite(y)) return
    const floor = getFloor(floorId)
    if (!floor) return
    if (!isOutdoorFloor(floorId)) {
      await playEnterChoreography(floorId)
    }
    placeSpot(x, y, floorId)
    nextTick(() => mapRef.value?.focusSpot({ x, y, floorId }, { bottomPadding: 220 }))
  }
}

watch(selectedMarkerId, (id) => {
  if (id) router.replace({ query: { marker: id } })
  else if (route.query.marker && !userSpot.value) router.replace({ query: {} })
})

watch(userSpot, (s) => {
  if (s) router.replace({ query: { spot: `${s.floorId}:${s.x}:${s.y}` } })
  else if (route.query.spot && !selectedMarkerId.value) router.replace({ query: {} })
}, { deep: true })

onMounted(() => {
  measureBottomNavHeight()
  window.addEventListener('resize', measureBottomNavHeight)
})

// Returning to /map while already indoor leaves `mode`/`transitioning`
// unchanged, so the watcher never fires; reconcile once the engine is ready.
function maybeArmOnReady() {
  reconcileExitGesture()
}

onBeforeUnmount(() => {
  window.removeEventListener('resize', measureBottomNavHeight)
  // Selection is a session-scoped singleton; dismiss it on leave so it doesn't
  // greet the user on return. Deep links re-hydrate on the next mount.
  clearSelection()
  removeSpot()
})
</script>

<template>
  <div class="map-page" data-testid="map-page" :data-markers-ready="markersReady">
    <h1 class="map-page__title" data-testid="map-heading">Map</h1>

    <div class="map-page__canvas" data-testid="map-canvas">
      <ClientOnly>
        <VenueMap
          ref="mapRef"
          :markers="markers"
          :zones="zones"
          :active-floor-id="activeFloorId"
          :selected-marker-id="selectedMarkerId"
          :user-spot="userSpot"
          :bottom-nav-height="bottomNavHeight"
          :block-out-of-bounds="false"
          @marker-click="handleMarkerClick"
          @map-click="handleMapClick"
          @void-click="handleVoidClick"
          @building-click="handleBuildingClick"
          @ready="handleEngineReady"
        />
      </ClientOnly>

      <!-- Floor switcher (top-right of the map canvas). Includes Outdoor
           as the first option, so it's shown in both outdoor and indoor modes. -->
      <FloorControl
        v-if="!transitioning"
        class="map-page__floor-control"
        :floors="selectableFloors"
        :active-floor-id="activeFloorId"
        @change="handleFloorControlChange"
      />

      <!-- Outdoor hint (hidden after a selection / placed spot). -->
      <div
        v-if="!isIndoor && !transitioning && !hasSelection"
        class="map-page__hint"
        data-testid="map-tap-hint"
      >
        Tap to place a pin or open the building
      </div>

      <!-- Indoor hint: pin instructions + zoom-out exit cue. -->
      <div
        v-if="isIndoor && !hasSelection && !transitioning"
        class="map-page__empty-prompt"
        data-testid="map-empty-prompt"
      >
        Tap to place a pin or zoom out to go back
      </div>
    </div>

    <!-- Bottom card stack: shown in either mode whenever a marker is
         selected or a spot is placed. -->
    <div v-if="hasSelection && !transitioning" class="map-page__bottom">
      <MapSelectedCard
        :marker="selectedMarker"
        :headline="selectedChip.headline"
        :sub="selectedChip.sub"
        @share="handleShare"
        @close="handleClose"
      >
        <template v-if="sessionStrip" #strip>
          <MapSessionStrip
            :kind="sessionStrip.kind"
            :source="sessionStrip.source"
            :title="sessionStrip.title"
            :minutes="sessionStrip.minutes"
            @click="openSession"
          />
        </template>
      </MapSelectedCard>
    </div>

    <div
      v-if="toast"
      class="map-page__toast"
      :class="{ 'map-page__toast--above-strip': sessionStrip }"
    >{{ toast }}</div>
  </div>
</template>

<style scoped>
.map-page {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 100%;
  color: #ffffff;
}

.map-page__title {
  font-family: inherit;
  font-size: 1.5rem;
  font-weight: 600;
  margin: 16px 0;
}

.map-page__floor-control {
  position: absolute;
  top: 12px;
  right: 16px;
  z-index: 1000;
}

.map-page__canvas {
  position: relative;
  flex: 1;
  min-height: 360px;
  margin: 16px -16px 0;
  background: #000;
  overflow: hidden;
}

.map-page__hint,
.map-page__empty-prompt {
  position: fixed;
  left: 0;
  right: 0;
  bottom: calc(var(--safe-bottom) + 52px + 24px);
  z-index: 1000;
  text-align: center;
  padding: 0 20px;
  color: rgba(255, 255, 255, 0.9);
  font-size: 15px;
  font-weight: 500;
  pointer-events: none;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}

.map-page__bottom {
  position: fixed;
  left: 16px;
  right: 16px;
  bottom: calc(var(--safe-bottom) + 52px + 12px);
  z-index: 1100;
  display: flex;
  flex-direction: column;
}

.map-page__toast {
  position: fixed;
  left: 50%;
  bottom: calc(var(--safe-bottom) + 52px + 100px);
  transform: translateX(-50%);
  z-index: 1200;
  padding: 10px 16px;
  background: rgba(15, 15, 15, 0.95);
  color: #ffffff;
  border-radius: 10px;
  font-size: 13px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}
.map-page__toast--above-strip {
  bottom: calc(var(--safe-bottom) + 52px + 160px);
}

@media (min-width: 768px) {
  .map-page__hint,
  .map-page__empty-prompt {
    left: var(--col-l, 0px);
    right: var(--col-r, 0px);
  }
  .map-page__bottom {
    left: calc(var(--col-l, 0px) + 16px);
    right: calc(var(--col-r, 0px) + 16px);
  }
  .map-page__toast {
    left: calc(var(--col-l, 0px) + ((100vw - var(--col-l, 0px) - var(--col-r, 0px)) / 2));
  }
}
</style>
