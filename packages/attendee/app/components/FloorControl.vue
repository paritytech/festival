<script setup lang="ts">
import type { VenueFloor } from '@festival/shared/metadata/schemas'

defineProps<{
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
    class="floor-control floor-control--stack"
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
  <div
    v-else-if="floors.length === 1"
    class="floor-control floor-control--single"
    data-testid="floor-control"
  >
    {{ floors[0].label }}
  </div>
</template>

<style scoped>
.floor-control--stack {
  display: inline-flex;
  flex-direction: column;
  padding: 4px;
  background: var(--color-bg-surface-container);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-md);
}
.floor-control--single {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 6px 11px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.2;
  color: var(--color-fg-secondary);
  background: var(--color-bg-surface-container);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-md);
}
.floor-control__pill {
  min-height: 30px;
  padding: 6px 11px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.2;
  text-align: center;
  white-space: nowrap;
  background: transparent;
  color: var(--color-fg-secondary);
  border: 0;
  border-radius: var(--radius-xl);
  cursor: pointer;
  transition: background 150ms, color 150ms;
}
.floor-control__pill:hover {
  color: var(--color-fg-primary);
}
.floor-control__pill.is-active {
  background: var(--color-bg-surface-container-inverted);
  color: var(--color-fg-primary-inverted);
}
</style>
