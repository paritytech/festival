<script setup lang="ts">
import { computed, useTemplateRef, watch } from 'vue'
import { decodeBadgeHex } from '@festival/shared/utils/badge'
import { formatDateBerlin } from '@festival/shared/utils/time'
import { formatTimeLabel } from '@festival/shared'
import {
  encodeCoordLocation,
  resolveFullLocationLabel,
  type PickedLocation,
} from '@festival/shared/venue/floors'
import type { VenueMarker, VenueZone } from '@festival/shared/metadata/schemas'
import VenueMap from '~/components/VenueMap.vue'
import EditButton from './ui/EditButton.vue'

const props = defineProps<{
  name: string
  speaker: string
  description: string
  dateKey: string
  startMinutesOfDay: number | null
  endMinutesOfDay: number | null
  badgeHex: string
  pickedLocation: PickedLocation | null
  venueMarkers: VenueMarker[]
  venueZones: VenueZone[]
}>()

defineEmits<{
  edit: [step: 1 | 2 | 3]
}>()

const mapRef = useTemplateRef<InstanceType<typeof VenueMap>>('mapRef')

function focusSpot() {
  if (!props.pickedLocation) return
  // sticky:true so the map stays centered on the spot when layout above
  // changes height (e.g. images/badges loading in).
  mapRef.value?.focusSpot(
    {
      x: props.pickedLocation.x,
      y: props.pickedLocation.y,
      floorId: props.pickedLocation.floorId,
    },
    { bottomPadding: 0, sticky: true },
  )
}

watch(() => props.pickedLocation, () => focusSpot())

const dateLabel = computed(() =>
  props.dateKey
    ? formatDateBerlin(`${props.dateKey}T12:00:00`, { day: 'numeric', month: 'long' })
    : '',
)

const timeLabel = computed(() => {
  if (props.startMinutesOfDay == null || props.endMinutesOfDay == null) return ''
  return `${formatTimeLabel(props.startMinutesOfDay)} - ${formatTimeLabel(props.endMinutesOfDay)}`
})

const locationLabel = computed(() => {
  const loc = props.pickedLocation
  if (!loc) return ''
  return resolveFullLocationLabel(
    encodeCoordLocation(loc.floorId, loc.zoneId, loc.x, loc.y),
    props.venueMarkers,
    props.venueZones,
  )
})
</script>

<template>
  <div class="px-4 pb-7">
    <!-- Session Badge -->
    <section class="mb-10">
      <header class="flex items-center justify-between mb-2">
        <h2 class="text-lg leading-[22px] font-semibold text-text-and-icons-secondary">Session Badge</h2>
        <EditButton
          data-testid="overview-edit-badge"
          aria-label="Edit badge"
          @click="$emit('edit', 3)"
        />
      </header>
      <div v-if="badgeHex" class="aspect-square rounded-2xl overflow-hidden">
        <BadgeCanvas :pixels="decodeBadgeHex(badgeHex)" :size="128" />
      </div>
    </section>

    <!-- Session Details -->
    <section class="mb-10">
      <header class="flex items-center justify-between mb-2">
        <h2 class="text-lg leading-[22px] font-semibold text-text-and-icons-secondary">Session Details</h2>
        <EditButton
          data-testid="overview-edit-details"
          aria-label="Edit details"
          @click="$emit('edit', 1)"
        />
      </header>
      <h3 class="text-2xl leading-8 font-semibold text-text-and-icons-primary">{{ name }}</h3>
      <p
        v-if="description"
        class="text-sm leading-5 font-normal text-text-and-icons-primary whitespace-pre-line"
      >
        {{ description }}
      </p>

      <div class="mt-3 space-y-3">
        <div v-if="speaker">
          <p class="text-xs leading-[18px] text-text-and-icons-secondary">Session Speaker</p>
          <p class="text-lg font-semibold text-text-and-icons-primary">{{ speaker }}</p>
        </div>
        <div>
          <p class="text-xs leading-[18px] text-text-and-icons-secondary">Session Date</p>
          <p class="text-lg font-semibold text-text-and-icons-primary">{{ dateLabel }}</p>
        </div>
        <div>
          <p class="text-xs leading-[18px] text-text-and-icons-secondary">Session Time</p>
          <p class="text-lg font-semibold text-text-and-icons-primary">{{ timeLabel }}</p>
        </div>
      </div>
    </section>

    <!-- Session Location -->
    <section>
      <header class="flex items-center justify-between mb-2">
        <h2 class="text-lg leading-[22px] font-semibold text-text-and-icons-secondary">Session Location</h2>
        <EditButton
          data-testid="overview-edit-location"
          aria-label="Edit location"
          @click="$emit('edit', 2)"
        />
      </header>
      <p class="text-2xl leading-8 font-semibold text-text-and-icons-primary mb-4">{{ locationLabel }}</p>
      <div
        v-if="pickedLocation"
        class="relative aspect-[4/3] rounded-2xl overflow-hidden isolate"
      >
        <VenueMap
          ref="mapRef"
          :markers="venueMarkers"
          :zones="venueZones"
          :active-floor-id="pickedLocation.floorId"
          :user-spot="{ x: pickedLocation.x, y: pickedLocation.y, floorId: pickedLocation.floorId }"
          :interactive="false"
          @ready="focusSpot"
        />
      </div>
    </section>
  </div>
</template>
