<script setup lang="ts">
import { ref, shallowRef, watch, onMounted, onBeforeUnmount, useTemplateRef } from 'vue'
import type { VenueMarker, VenueZone } from '@festival/shared/metadata/schemas'
import { getFloor } from '@festival/shared/venue/floors'
import type { FocusOpts, UserSpot, VenueMapHandle } from '@festival/shared/venue/map-engine-ml'

const props = withDefaults(defineProps<{
  markers: VenueMarker[]
  zones: VenueZone[]
  activeFloorId: string
  selectedMarkerId?: string | null
  userSpot?: UserSpot | null
  interactive?: boolean
  bottomNavHeight?: number
  blockOutOfBounds?: boolean
}>(), {
  selectedMarkerId: null,
  userSpot: null,
  interactive: true,
  bottomNavHeight: 0,
  blockOutOfBounds: true,
})

const emit = defineEmits<{
  markerClick: [marker: VenueMarker]
  mapClick: [loc: { x: number; y: number; floorId: string }]
  blockedClick: [loc: { x: number; y: number; floorId: string }]
  voidClick: []
  buildingClick: []
  ready: []
}>()

const containerRef = useTemplateRef<HTMLDivElement>('containerRef')
const engine = shallowRef<VenueMapHandle | null>(null)
const isReady = ref(false)

onMounted(async () => {
  const { createVenueMap } = await import('@festival/shared/venue/map-engine-ml')
  await import('maplibre-gl/dist/maplibre-gl.css')
  await import('@festival/shared/venue/map.css')

  if (!containerRef.value) return

  engine.value = await createVenueMap(containerRef.value, {
    interactive: props.interactive,
    bottomNavHeight: props.bottomNavHeight,
    blockOutOfBounds: props.blockOutOfBounds,
    onMarkerClick: (m) => emit('markerClick', m),
    onMapClick: (loc) => emit('mapClick', loc),
    onBlockedClick: (loc) => emit('blockedClick', loc),
    onVoidClick: () => emit('voidClick'),
    onBuildingClick: () => emit('buildingClick'),
    onReady: () => {
      if (!isReady.value) {
        isReady.value = true
        emit('ready')
      }
    },
  })

  const floor = getFloor(props.activeFloorId)
  if (floor) await engine.value.setFloor(floor)
  engine.value.setZones(props.zones)
  engine.value.setMarkers(props.markers)
  engine.value.setSelectedMarker(props.selectedMarkerId ?? null)
  engine.value.setUserSpot(props.userSpot ?? null)
})

// Floor switch.
watch(() => props.activeFloorId, async (id) => {
  const floor = getFloor(id)
  if (floor && engine.value) {
    await engine.value.setFloor(floor)
    // Zones + markers need to re-render for the new floor's coordinate system.
    engine.value.setZones(props.zones)
    engine.value.setMarkers(props.markers)
    engine.value.setSelectedMarker(props.selectedMarkerId ?? null)
    engine.value.setUserSpot(props.userSpot ?? null)
  }
})

watch(() => props.markers, (m) => engine.value?.setMarkers(m), { deep: true })
watch(() => props.zones, (z) => engine.value?.setZones(z), { deep: true })
watch(() => props.selectedMarkerId, (id) => engine.value?.setSelectedMarker(id ?? null))
watch(() => props.userSpot, (s) => engine.value?.setUserSpot(s ?? null), { deep: true })
watch(() => props.bottomNavHeight, (px) => engine.value?.setBottomNavHeight(px))

onBeforeUnmount(() => {
  engine.value?.destroy()
  engine.value = null
})

defineExpose({
  focusMarker: (id: string, opts?: FocusOpts) => engine.value?.focusMarker(id, opts),
  focusSpot: (spot: UserSpot, opts?: FocusOpts) => engine.value?.focusSpot(spot, opts),
  fitToFloor: () => engine.value?.fitToFloor(),
  invalidateSize: () => engine.value?.invalidateSize(),
  getZoneAt: (x: number, y: number) => engine.value?.getZoneAt(x, y) ?? null,
  isPointInForbiddenZone: (x: number, y: number) =>
    engine.value?.isPointInForbiddenZone(x, y) ?? false,
  setTransitioning: (value: boolean) => engine.value?.setTransitioning(value),
  flyToBuildingBounds: (opts?: { duration?: number; maxZoomDelta?: number }) =>
    engine.value?.flyToBuildingBounds(opts) ?? Promise.resolve(false),
  fadeFlash: (direction: 'in' | 'out', durationMs: number) =>
    engine.value?.fadeFlash(direction, durationMs) ?? Promise.resolve(),
  enableZoomOutGesture: (opts: { belowFitBy?: number; onTrigger: () => void }) =>
    engine.value?.enableZoomOutGesture(opts),
  disableZoomOutGesture: () => engine.value?.disableZoomOutGesture(),
})
</script>

<template>
  <div ref="containerRef" class="venue-map-container" data-testid="venue-map" />
</template>

<style scoped>
/* Absolute-fill so the container has a definite size regardless of parent flex layout. */
.venue-map-container {
  position: absolute;
  inset: 0;
}
</style>
