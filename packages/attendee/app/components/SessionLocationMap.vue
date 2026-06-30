<script setup lang="ts">
import { computed, useTemplateRef } from "vue";
import type { VenueMarker, VenueZone } from "@festival/shared/metadata/schemas";
import { parseCoordLocation, getFloor } from "@festival/shared/venue/floors";
import VenueMap from "~/components/VenueMap.vue";

const props = defineProps<{
  location?: string | null;
  markers: VenueMarker[];
  zones: VenueZone[];
}>();

const mapRef = useTemplateRef<InstanceType<typeof VenueMap>>("mapRef");

type Resolved =
  | {
      kind: "spot";
      floorId: string;
      spot: { x: number; y: number; floorId: string };
    }
  | { kind: "marker"; floorId: string; marker: VenueMarker }
  | { kind: "unknown" }
  | null;

const resolved = computed<Resolved>(() => {
  if (!props.location) return null;

  const coord = parseCoordLocation(props.location);
  if (coord) {
    if (!getFloor(coord.floorId)) return { kind: "unknown" };
    return {
      kind: "spot",
      floorId: coord.floorId,
      spot: { x: coord.x, y: coord.y, floorId: coord.floorId },
    };
  }

  const marker = props.markers.find((m) => m.id === props.location);
  if (!marker) return null;
  if (!getFloor(marker.floorId)) return { kind: "unknown" };
  return { kind: "marker", floorId: marker.floorId, marker };
});

// Render only the session's marker (no other context markers).
const focusedMarkers = computed<VenueMarker[]>(() =>
  resolved.value?.kind === "marker" ? [resolved.value.marker] : [],
);

function handleReady() {
  if (!resolved.value) return;
  // Zoom in to roughly "one room of context" around the pin. sticky:true
  // re-applies the focus after later container resizes (mobile reflows, badge
  // decoding, footer sizing); otherwise the engine's ResizeObserver snaps back
  // to the floor centroid and hides the pin.
  const opts = { targetZoomDelta: 1, animate: false, sticky: true };
  if (resolved.value.kind === "spot") {
    mapRef.value?.focusSpot(resolved.value.spot, opts);
  } else if (resolved.value.kind === "marker") {
    mapRef.value?.focusMarker(resolved.value.marker.id, opts);
  }
}
</script>

<template>
  <div class="aspect-[4/3] rounded-2xl overflow-hidden bg-bg-surface-nested relative">
    <ClientOnly>
      <VenueMap
        v-if="resolved && resolved.kind !== 'unknown'"
        ref="mapRef"
        :markers="focusedMarkers"
        :zones="zones"
        :active-floor-id="resolved.floorId"
        :selected-marker-id="
          resolved.kind === 'marker' ? resolved.marker.id : null
        "
        :user-spot="resolved.kind === 'spot' ? resolved.spot : null"
        :interactive="false"
        @ready="handleReady"
      />
      <div v-else class="w-full h-full flex items-center justify-center">
        <p class="text-xs text-text-and-icons-tertiary">
          {{
            resolved?.kind === "unknown"
              ? "Location unavailable"
              : "Location not set"
          }}
        </p>
      </div>
    </ClientOnly>
  </div>
</template>
