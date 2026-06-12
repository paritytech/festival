<script setup lang="ts">
import { ref, shallowRef, watch, onMounted, onBeforeUnmount, useTemplateRef } from 'vue'
import type { VenueMarker, VenueZone } from '@festival/shared/metadata/schemas'
import { getFloor } from '@festival/shared/venue/floors'
import type { UserSpot, VenueMapHandle } from '@festival/shared/venue/map-engine-ml'

const props = withDefaults(defineProps<{
  markers: VenueMarker[]
  zones: VenueZone[]
  activeFloorId: string
  selectedMarkerId?: string | null
  userSpot?: UserSpot | null
  interactive?: boolean
}>(), {
  selectedMarkerId: null,
  userSpot: null,
  interactive: true,
})

const emit = defineEmits<{
  markerClick: [marker: VenueMarker]
  mapClick: [loc: { x: number; y: number; floorId: string }]
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
    // Admin's landscape viewport would over-zoom the portrait outdoor venue
    // under cover fit; contain shows the whole venue for marker placement.
    outdoorFit: 'contain',
    onMarkerClick: (m) => emit('markerClick', m),
    onMapClick: (loc) => emit('mapClick', loc),
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

onBeforeUnmount(() => {
  engine.value?.destroy()
  engine.value = null
})

defineExpose({
  focusMarker: (id: string, opts?: { bottomPadding?: number }) => engine.value?.focusMarker(id, opts),
  focusSpot: (spot: UserSpot, opts?: { bottomPadding?: number }) => engine.value?.focusSpot(spot, opts),
  fitToFloor: () => engine.value?.fitToFloor(),
  invalidateSize: () => engine.value?.invalidateSize(),
  getZoneAt: (x: number, y: number) => engine.value?.getZoneAt(x, y) ?? null,
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
