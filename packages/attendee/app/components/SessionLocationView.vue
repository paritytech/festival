<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { VenueMarker, VenueZone } from '@festival/shared/metadata/schemas'
import {
  getBlockByFloor,
  getFloor,
  getMapContextLabel,
  formatChipFromMarker,
  isOutdoorFloor,
  parseCoordLocation,
} from '@festival/shared/venue/floors'
import VenueMap from '~/components/VenueMap.vue'
import FloorControl from '~/components/FloorControl.vue'
import MapSelectedCard from '~/components/MapSelectedCard.vue'
import SessionTopBar from '~/components/SessionTopBar.vue'

const props = defineProps<{
  location: string
  markers: VenueMarker[]
  zones: VenueZone[]
  sessionAddress: string
}>()

const emit = defineEmits<{
  close: []
}>()

type Resolved =
  | { kind: 'spot'; floorId: string; spot: { x: number; y: number; floorId: string } }
  | { kind: 'marker'; floorId: string; marker: VenueMarker }
  | { kind: 'unknown' }
  | null

const resolved = computed<Resolved>(() => {
  if (!props.location) return null

  const coord = parseCoordLocation(props.location)
  if (coord) {
    if (!getFloor(coord.floorId)) return { kind: 'unknown' }
    return {
      kind: 'spot',
      floorId: coord.floorId,
      spot: { x: coord.x, y: coord.y, floorId: coord.floorId },
    }
  }

  const marker = props.markers.find((m) => m.id === props.location)
  if (!marker) return null
  if (!getFloor(marker.floorId)) return { kind: 'unknown' }
  return { kind: 'marker', floorId: marker.floorId, marker }
})

const activeFloorId = ref<string>('')
watch(
  resolved,
  (r) => {
    if (r && r.kind !== 'unknown') activeFloorId.value = r.floorId
  },
  { immediate: true },
)

const activeBlock = computed(() => {
  if (!activeFloorId.value || isOutdoorFloor(activeFloorId.value)) return undefined
  return getBlockByFloor(activeFloorId.value)
})

// Chip used by the bottom MapSelectedCard. Marker → marker name + "Floor · Zone"
// (formatChipFromMarker falls back to the type label for icon-only markers that
// save with an empty label). Spot-resolved sessions (coord locations) have no
// marker, so the chip falls back to the floor only.
const chip = computed(() => {
  if (resolved.value?.kind === 'marker') {
    return formatChipFromMarker(resolved.value.marker, props.zones)
  }
  if (resolved.value?.kind === 'spot') {
    return {
      headline: 'Pinned location',
      sub: getMapContextLabel(resolved.value.floorId),
    }
  }
  return { headline: '', sub: '' }
})

const topLeftLabel = computed(() => {
  if (!activeFloorId.value) return ''
  if (isOutdoorFloor(activeFloorId.value)) return 'Outdoors'
  const floor = getFloor(activeFloorId.value)
  if (!floor) return ''
  return /floor/i.test(floor.label) ? floor.label : `${floor.label} Floor`
})

const onSessionFloor = computed(() => {
  if (!resolved.value || resolved.value.kind === 'unknown') return false
  return resolved.value.floorId === activeFloorId.value
})

const mapRef = useTemplateRef<InstanceType<typeof VenueMap>>('mapRef')

function focusSessionTarget() {
  if (!resolved.value || resolved.value.kind === 'unknown' || !onSessionFloor.value) return
  const opts = { bottomPadding: 220, animate: false, sticky: true }
  if (resolved.value.kind === 'spot') {
    mapRef.value?.focusSpot(resolved.value.spot, opts)
  } else {
    mapRef.value?.focusMarker(resolved.value.marker.id, opts)
  }
}

function handleReady() {
  focusSessionTarget()
}

function switchFloor(floorId: string) {
  if (!getFloor(floorId) || isOutdoorFloor(floorId)) return
  activeFloorId.value = floorId
  // After the floor swap settles, re-focus the session pin only if the user
  // returned to its floor; otherwise leave the map fit to the new floor.
  nextTick(() => focusSessionTarget())
}

const router = useRouter()

async function handleShare() {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return
  if (!resolved.value || resolved.value.kind === 'unknown') return
  const where = `${chip.value.headline || 'Location'} — ${chip.value.sub}`
  // Hash-mode share URL, matching the convention in pages/map.vue.
  const fullPath = router.resolve(`/sessions/${props.sessionAddress}`).fullPath
  const url = `${window.location.origin}/#${fullPath}`
  try {
    if (navigator.share) {
      await navigator.share({ text: where, url })
      return
    }
    await navigator.clipboard?.writeText(`${where}\n${url}`)
  } catch {
    /* user dismissed */
  }
}
</script>

<template>
  <Teleport to="body">
  <div class="loc-view" role="dialog" aria-label="Session location" data-testid="session-location-view">
    <!-- Same max-w column as the underlying <main>, so the top bar lands in
         identical screen coords on every viewport. -->
    <div class="mx-auto w-full max-w-md md:max-w-none">
      <SessionTopBar
        title="Session Location"
        title-testid="session-location-title"
        back-testid="session-location-back"
        @back="emit('close')"
      />
    </div>

    <!-- Map canvas -->
    <div class="loc-view__canvas">
      <ClientOnly>
        <VenueMap
          v-if="resolved && resolved.kind !== 'unknown' && activeFloorId"
          ref="mapRef"
          :markers="markers"
          :zones="zones"
          :active-floor-id="activeFloorId"
          :selected-marker-id="
            resolved.kind === 'marker' && onSessionFloor ? resolved.marker.id : null
          "
          :user-spot="resolved.kind === 'spot' && onSessionFloor ? resolved.spot : null"
          :interactive="false"
          @ready="handleReady"
        />
        <div v-else class="loc-view__empty">
          <p>
            {{
              resolved?.kind === 'unknown'
                ? 'Location unavailable'
                : 'Location not set'
            }}
          </p>
        </div>
      </ClientOnly>

      <!-- Overlay row: floor label + floor switcher -->
      <div class="loc-view__overlay-row">
        <div class="loc-view__floor-label">{{ topLeftLabel }}</div>
        <FloorControl
          v-if="activeBlock && activeBlock.floors.length > 1"
          :floors="activeBlock.floors"
          :active-floor-id="activeFloorId"
          @change="switchFloor"
        />
        <div v-else />
      </div>
    </div>

    <!-- Bottom location card -->
    <div v-if="resolved && resolved.kind !== 'unknown'" class="loc-view__bottom">
      <MapSelectedCard
        :marker="resolved.kind === 'marker' ? resolved.marker : null"
        :headline="chip.headline"
        :sub="chip.sub"
        @share="handleShare"
        @close="emit('close')"
      />
    </div>
  </div>
  </Teleport>
</template>

<style scoped>
.loc-view {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: #000;
  color: var(--color-text-and-icons-primary);
  display: flex;
  flex-direction: column;
  padding-top: var(--safe-top);
}

.loc-view__canvas {
  position: relative;
  flex: 1;
  min-height: 0;
  background: #000;
  overflow: hidden;
}

.loc-view__overlay-row {
  position: absolute;
  top: 12px;
  left: 16px;
  right: 16px;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  pointer-events: none;
}
.loc-view__overlay-row > * {
  pointer-events: auto;
}

.loc-view__floor-label {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-and-icons-primary);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
  pointer-events: none;
}

.loc-view__empty {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--color-text-and-icons-tertiary);
}

.loc-view__bottom {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: calc(var(--safe-bottom) + 16px);
  z-index: 20;
}
</style>
