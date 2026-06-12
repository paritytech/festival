<script setup lang="ts">
import { computed, useTemplateRef, watch } from 'vue'
import type { VenueMarker, VenueZone } from '@festival/shared/metadata/schemas'
import {
  encodeCoordLocation,
  resolveFullLocationLabel,
  type PickedLocation,
} from '@festival/shared/venue/floors'
import VenueMap from '~/components/VenueMap.vue'

const props = defineProps<{
  loc: PickedLocation
  markers: VenueMarker[]
  zones: VenueZone[]
}>()

defineEmits<{
  'pick-another': []
}>()

const mapRef = useTemplateRef<InstanceType<typeof VenueMap>>('mapRef')

const longLabel = computed(() =>
  resolveFullLocationLabel(
    encodeCoordLocation(props.loc.floorId, props.loc.zoneId, props.loc.x, props.loc.y),
    props.markers,
    props.zones,
  ),
)

function focusSpot() {
  // sticky:true so layout reflows below the map card (button reveal,
  // breadcrumb re-render) don't snap the view off the dropped pin.
  mapRef.value?.focusSpot(
    { x: props.loc.x, y: props.loc.y, floorId: props.loc.floorId },
    { bottomPadding: 0, sticky: true },
  )
}

watch(
  () => props.loc,
  () => focusSpot(),
  { deep: true },
)
</script>

<template>
  <div class="slv">
    <div class="slv__map-card">
      <VenueMap
        ref="mapRef"
        :markers="markers"
        :zones="zones"
        :active-floor-id="loc.floorId"
        :user-spot="{ x: loc.x, y: loc.y, floorId: loc.floorId }"
        :interactive="false"
        @ready="focusSpot"
      />
    </div>

    <div class="slv__label">
      <div class="slv__label-caption">Location</div>
      <div class="slv__label-value">{{ longLabel }}</div>
    </div>

    <button type="button" class="slv__pick-another" @click="$emit('pick-another')">
      Pick another spot
    </button>
  </div>
</template>

<style scoped>
.slv {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 4px 16px 0;
}

.slv__map-card {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 22px;
  overflow: hidden;
}

.slv__label-caption {
  color: rgba(255, 255, 255, 0.4);
  font-size: 12px;
  font-weight: 500;
  margin-bottom: 4px;
}
.slv__label-value {
  color: #fff;
  font-size: 22px;
  font-weight: 700;
  line-height: 1.2;
}

.slv__pick-another {
  align-self: stretch;
  height: 48px;
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  border: 0;
  border-radius: 16px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}
</style>
