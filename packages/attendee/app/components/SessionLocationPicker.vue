<script setup lang="ts">
import { ref, computed, watch, useTemplateRef, nextTick } from 'vue'
import type { VenueMarker, VenueZone } from '@festival/shared/metadata/schemas'
import {
  VENUE_OUTDOOR_FLOOR,
  VENUE_BLOCKS,
  DEFAULT_FLOOR_ID,
  getBlockByFloor,
  isOutdoorFloor,
  formatChipFromPicked,
  type PickedLocation,
} from '@festival/shared/venue/floors'
import { isMarkerAllowedAsSessionLocation } from '@festival/shared/venue/categories'
import VenueMap from '~/components/VenueMap.vue'
import FloorControl from '~/components/FloorControl.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    initial: PickedLocation | null
    markers: VenueMarker[]
    zones: VenueZone[]
    title?: string
  }>(),
  { title: 'Session Location' },
)

const emit = defineEmits<{
  done: [loc: PickedLocation]
  cancel: []
}>()

const mapRef = useTemplateRef<InstanceType<typeof VenueMap>>('mapRef')

const tempLoc = ref<PickedLocation | null>(null)
const toast = ref<string | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(msg: string) {
  toast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = null }, 2000)
}

type PickerMode = 'outdoor' | 'indoor'
const mode = ref<PickerMode>('outdoor')
const indoorFloorId = ref<string>(DEFAULT_FLOOR_ID)

const isIndoor = computed(() => mode.value === 'indoor')
const activeFloorId = computed(() =>
  isIndoor.value ? indoorFloorId.value : VENUE_OUTDOOR_FLOOR.id,
)
const activeBlock = computed(() =>
  isIndoor.value ? getBlockByFloor(indoorFloorId.value) : undefined,
)
const selectableFloors = computed(() => {
  const block = activeBlock.value ?? VENUE_BLOCKS[0]
  return [VENUE_OUTDOOR_FLOOR, ...(block?.floors ?? [])]
})
// Only render the user spot when the active floor matches the picked floor.
// Keeps the pin off the wrong plan when the user is browsing other floors.
const userSpotForView = computed(() =>
  tempLoc.value && tempLoc.value.floorId === activeFloorId.value
    ? { x: tempLoc.value.x, y: tempLoc.value.y, floorId: tempLoc.value.floorId }
    : null,
)

const cardParts = computed(() =>
  tempLoc.value
    ? formatChipFromPicked(tempLoc.value, props.markers, props.zones)
    : null,
)

watch(
  () => props.open,
  (open) => {
    if (open) {
      tempLoc.value = props.initial ? { ...props.initial } : null
      if (props.initial) {
        if (isOutdoorFloor(props.initial.floorId)) {
          mode.value = 'outdoor'
        } else {
          mode.value = 'indoor'
          indoorFloorId.value = props.initial.floorId
        }
      } else {
        mode.value = 'outdoor'
        indoorFloorId.value = DEFAULT_FLOOR_ID
      }
      document.body.style.overflow = 'hidden'
      nextTick(() => mapRef.value?.invalidateSize())
    } else {
      document.body.style.overflow = ''
    }
  },
  { immediate: true },
)

function enterBuilding(floorId?: string) {
  mode.value = 'indoor'
  indoorFloorId.value = floorId && !isOutdoorFloor(floorId) ? floorId : DEFAULT_FLOOR_ID
  armPinchExit()
}

function exitToOutdoor() {
  // Safe even if the engine's one-shot listener has already self-removed.
  mapRef.value?.disableZoomOutGesture()
  mode.value = 'outdoor'
}

function switchFloor(floorId: string) {
  if (isOutdoorFloor(floorId)) return
  indoorFloorId.value = floorId
  // Gesture stays armed across indoor-floor switches: the engine re-applies
  // the loosened minZoom on the new floor's applyFit automatically.
}

function handleFloorControlChange(floorId: string) {
  if (floorId === activeFloorId.value) return
  const targetIsOutdoor = isOutdoorFloor(floorId)
  if (mode.value === 'outdoor' && !targetIsOutdoor) enterBuilding(floorId)
  else if (mode.value === 'indoor' && targetIsOutdoor) exitToOutdoor()
  else switchFloor(floorId)
}

/** Replaces the old `← Map` button. Once armed, a pinch-out past the
 *  threshold on any indoor floor fires `exitToOutdoor`. The engine's
 *  listener is one-shot. We re-arm on each fresh entry to the building. */
function armPinchExit() {
  mapRef.value?.enableZoomOutGesture({
    belowFitBy: 0.7,
    onTrigger: exitToOutdoor,
  })
}

function handleReady() {
  // Picker may open directly into indoor mode (editing an existing indoor
  // location). Arm the gesture once the map is ready in that case.
  if (isIndoor.value) armPinchExit()
}

function handleMapClick(loc: { x: number; y: number; floorId: string }) {
  const zoneId = mapRef.value?.getZoneAt(loc.x, loc.y) ?? null
  tempLoc.value = { x: loc.x, y: loc.y, floorId: loc.floorId, zoneId }
}

function handleMarkerClick(marker: VenueMarker) {
  if (!isMarkerAllowedAsSessionLocation(marker.type)) {
    showToast("You can't host a session here")
    return
  }
  if (mapRef.value?.isPointInForbiddenZone(marker.x, marker.y)) {
    showToast("You can't host a session here")
    return
  }
  tempLoc.value = {
    x: marker.x,
    y: marker.y,
    floorId: marker.floorId,
    zoneId: marker.zoneId ?? null,
  }
}

function handleDelete() {
  tempLoc.value = null
  mapRef.value?.fitToFloor()
}

function handleDone() {
  if (tempLoc.value) emit('done', { ...tempLoc.value })
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="slp" role="dialog" aria-modal="true" aria-label="Pick session location">
      <!-- Header -->
      <div class="slp__header">
        <button
          type="button"
          class="slp__icon-btn"
          aria-label="Close"
          @click="emit('cancel')"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <h1 class="slp__title">{{ title }}</h1>
        <button
          v-if="tempLoc"
          type="button"
          class="slp__done"
          @click="handleDone"
        >
          Done
        </button>
        <div v-else class="slp__done-spacer" />
      </div>

      <!-- Map area -->
      <div class="slp__map-wrap">
        <VenueMap
          ref="mapRef"
          :markers="markers"
          :zones="zones"
          :active-floor-id="activeFloorId"
          :user-spot="userSpotForView"
          :interactive="true"
          @map-click="handleMapClick"
          @marker-click="handleMarkerClick"
          @blocked-click="showToast('You can\'t drop a pin here')"
          @building-click="enterBuilding"
          @ready="handleReady"
        />

        <div v-if="toast" class="slp__toast" role="status">{{ toast }}</div>

        <FloorControl
          class="slp__floor-control"
          :floors="selectableFloors"
          :active-floor-id="activeFloorId"
          @change="handleFloorControlChange"
        />

        <!-- Empty-state hint -->
        <div v-if="!tempLoc" class="slp__hint">
          <template v-if="isIndoor">Tap to place a pin or zoom out to go back</template>
          <template v-else>Tap to place a pin or open the building</template>
        </div>

        <!-- Bottom card -->
        <div v-if="tempLoc && cardParts" class="slp__card">
          <div class="slp__card-tile">
            <img src="/icons/place.svg" alt="" width="24" height="24" />
          </div>
          <div class="slp__card-text">
            <div class="slp__card-caption">{{ cardParts.sub }}</div>
            <div class="slp__card-bold">{{ cardParts.headline }}</div>
          </div>
          <button
            type="button"
            class="slp__card-delete"
            aria-label="Remove location"
            @click="handleDelete"
          >
            <img src="/icons/delete.svg" alt="" width="22" height="22" />
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.slp {
  position: fixed;
  top: 0;
  bottom: 0;
  left: var(--col-l, 0px);
  right: var(--col-r, 0px);
  z-index: 60;
  background: #0f0f0f;
  display: flex;
  flex-direction: column;
  padding-top: var(--safe-top);
  padding-bottom: var(--safe-bottom);
}

.slp__header {
  display: flex;
  align-items: center;
  padding: 12px 12px 8px;
  gap: 8px;
}
.slp__icon-btn {
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 0;
  color: #fff;
  cursor: pointer;
  border-radius: 12px;
}
.slp__title {
  flex: 1;
  text-align: center;
  font-size: 15px;
  font-weight: 600;
  color: #fff;
}
.slp__done,
.slp__done-spacer {
  min-width: 64px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.slp__done {
  padding: 0 18px;
  background: #fff;
  color: #0f0f0f;
  border: 0;
  border-radius: 9999px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.slp__map-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
}

.slp__floor-control {
  position: absolute;
  top: 12px;
  right: 16px;
  z-index: 1000;
}

.slp__hint {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(var(--safe-bottom) + 24px);
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 0 32px;
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  pointer-events: none;
  z-index: 1100;
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.6);
}

.slp__toast {
  position: absolute;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  background: rgba(15, 15, 15, 0.92);
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  padding: 10px 16px;
  border-radius: 999px;
  pointer-events: none;
  z-index: 1200;
  white-space: nowrap;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}

.slp__card {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: calc(var(--safe-bottom) + 16px);
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  z-index: 1100;
}
.slp__card-tile {
  flex: none;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.slp__card-text {
  flex: 1;
  min-width: 0;
}
.slp__card-caption {
  color: rgba(15, 15, 15, 0.55);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.slp__card-bold {
  color: #0f0f0f;
  font-size: 17px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}
.slp__card-delete {
  flex: none;
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 49, 35, 0.1);
  border: 0;
  border-radius: 12px;
  cursor: pointer;
}
</style>
