<script setup lang="ts">
import type { VenueFloor } from '@festival/shared/metadata/schemas'

defineProps<{
  /** All selectable locations. Includes the outdoor pseudo-floor when the
   *  caller wants Outdoor to be reachable from this control. Order is preserved. */
  floors: VenueFloor[]
  activeFloorId: string
}>()

const emit = defineEmits<{
  change: [floorId: string]
}>()
</script>

<template>
  <div
    v-if="floors.length > 1"
    class="floor-control"
    role="tablist"
    data-testid="floor-control"
  >
    <button
      v-for="floor in floors"
      :key="floor.id"
      type="button"
      role="tab"
      :aria-selected="floor.id === activeFloorId"
      :data-testid="`floor-control-pill-${floor.id}`"
      :class="['floor-control__pill', { 'is-active': floor.id === activeFloorId }]"
      @click.stop="emit('change', floor.id)"
    >
      {{ floor.label }}
    </button>
  </div>
</template>

<style scoped>
.floor-control {
  display: inline-flex;
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
  padding: 4px;
  background: rgba(15, 15, 15, 0.72);
  border-radius: 12px;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}
.floor-control__pill {
  min-height: 44px;
  padding: 10px 16px;
  min-width: 104px;
  font-family: inherit;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.2;
  text-align: right;
  background: transparent;
  color: rgba(255, 255, 255, 0.65);
  border: 0;
  border-radius: 8px;
  cursor: pointer;
  transition: background 150ms, color 150ms;
}
.floor-control__pill:hover {
  color: rgba(255, 255, 255, 0.95);
}
.floor-control__pill.is-active {
  background: rgba(255, 255, 255, 0.12);
  color: #ffffff;
}
</style>
