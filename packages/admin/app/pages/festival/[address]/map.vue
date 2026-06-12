<script setup lang="ts">
import { ref, computed } from 'vue'
import { useFestivalContext } from '~/composables/useFestivalContext'
import { usePermissions } from '~/composables/usePermissions'
import type { VenueMarker } from '@festival/shared/metadata/schemas'
import {
  VENUE_BLOCKS,
  VENUE_OUTDOOR_FLOOR,
  DEFAULT_FLOOR_ID,
  getBlockByFloor,
  isOutdoorFloor,
} from '@festival/shared/venue/floors'
import { DEFAULT_ZONES } from '@festival/shared/venue/zones'
import { CATEGORIES, normalizeCategory, normalizeType } from '@festival/shared/venue/categories'
import { getMarkerIcon } from '@festival/shared/venue/icons'
import FloorControl from '~/components/FloorControl.vue'
import VenueMap from '~/components/VenueMap.vue'
import MarkerForm from '~/components/MarkerForm.vue'

definePageMeta({ layout: 'festival' })

const { draft, userRoles, markerStatus } = useFestivalContext()
const { canEditMetadata } = usePermissions(userRoles)

// Ensure venueMap exists on the draft (greenfield safety).
if (!draft.venueMap) {
  draft.venueMap = {
    blocks: VENUE_BLOCKS,
    zones: DEFAULT_ZONES,
    markers: [],
  }
}

type MapMode = 'outdoor' | 'indoor'

const mapRef = ref<InstanceType<typeof VenueMap> | null>(null)
const mode = ref<MapMode>('outdoor')
const indoorFloorId = ref<string>(DEFAULT_FLOOR_ID)
const editingMarker = ref<VenueMarker | null>(null)
const showMarkerForm = ref(false)

const markers = computed(() => draft.venueMap!.markers)
const zones = computed(() => draft.venueMap!.zones ?? DEFAULT_ZONES)

/**
 * Markers passed to the map = saved list + the in-progress marker (if any),
 * with the in-progress one replacing the saved entry when editing an existing
 * marker. This is what makes the live preview render under the form.
 */
const displayMarkers = computed(() => {
  const editing = editingMarker.value
  if (!editing || !showMarkerForm.value) return markers.value
  const others = markers.value.filter(m => m.id !== editing.id)
  return [...others, editing]
})

/** Force the in-progress marker to be visible regardless of zoom-tier reveal
 *  rules. `.is-selected` already carries `opacity: 1 !important` + a scale,
 *  doubling as a "this is what you're placing" affordance. */
const previewMarkerId = computed(() =>
  showMarkerForm.value && editingMarker.value ? editingMarker.value.id : null,
)

const isIndoor = computed(() => mode.value === 'indoor')
const activeFloorId = computed(() =>
  isIndoor.value ? indoorFloorId.value : VENUE_OUTDOOR_FLOOR.id,
)
const activeBlock = computed(() =>
  isIndoor.value ? getBlockByFloor(indoorFloorId.value) : undefined,
)

function nextMarkerId(): string {
  const existing = new Set(markers.value.map(m => m.id))
  let n = 1
  while (existing.has(`marker-${n}`)) n++
  return `marker-${n}`
}

function enterBuilding(floorId: string = DEFAULT_FLOOR_ID) {
  mode.value = 'indoor'
  indoorFloorId.value = floorId
  showMarkerForm.value = false
  editingMarker.value = null
}

function exitToOutdoor() {
  mode.value = 'outdoor'
  showMarkerForm.value = false
  editingMarker.value = null
}

function switchFloor(floorId: string) {
  if (isOutdoorFloor(floorId)) return
  indoorFloorId.value = floorId
  showMarkerForm.value = false
  editingMarker.value = null
}

function handleMapClick(loc: { x: number; y: number; floorId: string }) {
  if (!canEditMetadata.value) return
  const zoneId = mapRef.value?.getZoneAt?.(loc.x, loc.y) ?? undefined
  if (showMarkerForm.value && editingMarker.value) {
    editingMarker.value = { ...editingMarker.value, x: loc.x, y: loc.y, floorId: loc.floorId, zoneId }
  } else {
    editingMarker.value = {
      id: nextMarkerId(),
      label: '',
      x: loc.x,
      y: loc.y,
      floorId: loc.floorId,
      category: 'base',
      type: 'room',
      zoneId,
    }
    showMarkerForm.value = true
  }
}

function editMarker(marker: VenueMarker) {
  if (!canEditMetadata.value) return
  if (isOutdoorFloor(marker.floorId)) {
    mode.value = 'outdoor'
  } else {
    mode.value = 'indoor'
    indoorFloorId.value = marker.floorId
  }
  editingMarker.value = { ...marker }
  showMarkerForm.value = true
}

function saveMarker(marker: VenueMarker) {
  const idx = markers.value.findIndex(m => m.id === marker.id)
  if (idx >= 0) {
    draft.venueMap!.markers[idx] = { ...marker }
  } else {
    draft.venueMap!.markers.push({ ...marker })
  }
  showMarkerForm.value = false
  editingMarker.value = null
}

function removeMarker(id: string) {
  const idx = markers.value.findIndex(m => m.id === id)
  if (idx >= 0) draft.venueMap!.markers.splice(idx, 1)
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h2 class="font-heading text-2xl font-bold" data-testid="map-heading">Venue Map</h2>
    </div>

    <!-- Map canvas: outdoor overview with clickable building → indoor floors. -->
    <div class="admin-map-wrap" data-testid="map-canvas">
      <ClientOnly>
        <VenueMap
          ref="mapRef"
          :markers="displayMarkers"
          :zones="zones"
          :active-floor-id="activeFloorId"
          :selected-marker-id="previewMarkerId"
          @map-click="handleMapClick"
          @marker-click="editMarker"
          @building-click="enterBuilding()"
        />
      </ClientOnly>

      <button
        v-if="isIndoor"
        type="button"
        class="admin-map-wrap__back"
        data-testid="map-back-btn"
        aria-label="Back to outdoor view"
        @click="exitToOutdoor"
      >
        <span aria-hidden="true">←</span>
        <span>Map</span>
      </button>

      <div
        v-if="isIndoor && activeBlock"
        class="admin-map-wrap__floor-control"
      >
        <FloorControl
          :floors="activeBlock.floors"
          :active-floor-id="activeFloorId"
          @change="switchFloor"
        />
      </div>
    </div>

    <p v-if="canEditMetadata" class="text-xs text-text-muted mb-6" data-testid="map-edit-hint">
      <template v-if="isIndoor">Click on the map to place a new marker on this floor.</template>
      <template v-else>Click the building to enter, or place an outdoor marker by clicking the map.</template>
      Changes publish from the sidebar.
    </p>

    <!-- Marker form -->
    <div v-if="showMarkerForm && editingMarker" class="mb-6">
      <MarkerForm
        :marker="editingMarker"
        :zones="zones"
        @save="saveMarker"
        @update="(m) => editingMarker = m"
        @cancel="showMarkerForm = false; editingMarker = null"
      />
    </div>

    <!-- Markers list -->
    <div class="bg-surface rounded-xl p-5">
      <h3 class="font-medium mb-4">Markers ({{ markers.length }})</h3>

      <div v-if="markers.length" class="space-y-2">
        <div
          v-for="marker in markers"
          :key="marker.id"
          class="rounded-xl px-3 py-2"
          :class="{
            'bg-success-muted': markerStatus(marker.id) === 'new',
            'bg-warning-muted': markerStatus(marker.id) === 'modified',
            'bg-background': markerStatus(marker.id) === 'unchanged',
          }"
        >
          <div class="flex items-center gap-3">
            <span
              class="marker-row-icon"
              :style="{ background: CATEGORIES[normalizeCategory(marker.category)].color }"
              v-html="getMarkerIcon(normalizeCategory(marker.category), normalizeType(normalizeCategory(marker.category), marker.type))"
            />
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <p class="text-sm font-medium truncate">{{ marker.label || '(no label)' }}</p>
                <span v-if="markerStatus(marker.id) === 'new'" class="text-[10px] px-1.5 py-0.5 rounded bg-success/12 text-success font-medium shrink-0">New</span>
                <span v-else-if="markerStatus(marker.id) === 'modified'" class="text-[10px] px-1.5 py-0.5 rounded bg-warning/12 text-warning font-medium shrink-0">Edited</span>
                <span v-if="!marker.category" class="text-[10px] px-1.5 py-0.5 rounded bg-warning/12 text-warning font-medium shrink-0">Legacy</span>
              </div>
              <p class="text-xs text-text-muted font-mono truncate">
                {{ normalizeCategory(marker.category) }}/{{ normalizeType(normalizeCategory(marker.category), marker.type) }} · {{ marker.floorId }} · ({{ marker.x }}, {{ marker.y }})<span v-if="marker.zoneId"> · {{ marker.zoneId }}</span>
              </p>
            </div>
            <div v-if="canEditMetadata" class="flex gap-1 shrink-0">
              <button class="text-xs text-text-muted hover:text-text-primary px-2 py-1" @click="editMarker(marker)">Edit</button>
              <button class="text-xs text-danger hover:text-danger/80 px-2 py-1" @click="removeMarker(marker.id)">Remove</button>
            </div>
          </div>
        </div>
      </div>
      <p v-else class="text-text-muted text-sm">No markers yet. Click the map to add one.</p>
    </div>
  </div>
</template>

<style scoped>
.admin-map-wrap {
  position: relative;
  width: 100%;
  height: 560px;
  background: #000;
  border-radius: 12px;
  overflow: hidden;
  margin-bottom: 12px;
  isolation: isolate;
}
.admin-map-wrap__floor-control {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 1000;
}

.admin-map-wrap__back {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 1000;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: rgba(15, 15, 15, 0.78);
  color: #ffffff;
  border: 0;
  border-radius: 999px;
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}
.admin-map-wrap__back:hover { background: rgba(15, 15, 15, 0.92); }

.marker-row-icon {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex: none;
}
.marker-row-icon :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
