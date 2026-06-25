<script setup lang="ts">
import { computed } from 'vue'
import IconLocationOn from '~icons/ic/round-location-on'
import IconShare from '~icons/ic/round-share'
import IconClose from '~icons/ic/round-close'
import type { VenueMarker } from '@festival/shared/metadata/schemas'
import { getCategory } from '@festival/shared/venue/categories'
import { getMarkerIcon } from '@festival/shared/venue/icons'

const props = defineProps<{
  marker?: VenueMarker | null
  headline: string
  sub: string
}>()

defineEmits<{
  share: []
  close: []
}>()

const mode = computed<'marker' | 'spot'>(() => (props.marker ? 'marker' : 'spot'))
const iconHtml = computed(() =>
  props.marker ? getMarkerIcon(props.marker.category, props.marker.type) : null,
)
const categoryColor = computed(() =>
  props.marker ? getCategory(props.marker.category).color : undefined,
)
</script>

<template>
  <div class="sel-card" role="group" aria-label="Selected location" data-testid="map-selected-card">
    <!-- Optional session strip: a black card inset inside this white card. -->
    <slot name="strip" />

    <div class="sel-card__row">
      <!-- Icon tile: colored circle for typed markers, neutral pin tile for spots -->
      <div
        class="sel-card__tile"
        :class="{ 'sel-card__tile--spot': mode === 'spot' }"
        :style="mode === 'marker' && categoryColor ? { background: categoryColor } : undefined"
      >
        <span v-if="mode === 'marker'" class="sel-card__tile-glyph" v-html="iconHtml" />
        <IconLocationOn v-else class="sel-card__tile-pin" aria-hidden="true" />
      </div>

      <div class="sel-card__text">
        <div class="sel-card__breadcrumb">{{ sub }}</div>
        <div class="sel-card__primary">{{ headline }}</div>
      </div>

      <div class="sel-card__actions">
        <button
          type="button"
          class="sel-card__btn"
          aria-label="Share location"
          @click="$emit('share')"
        >
          <IconShare class="sel-card__icon" />
        </button>
        <button
          type="button"
          class="sel-card__btn"
          aria-label="Close"
          @click="$emit('close')"
        >
          <IconClose class="sel-card__icon" style="width:28px;height:28px" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sel-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  background: #ffffff;
  color: #0f0f0f;
  border-radius: 16px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
}

.sel-card__row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 4px 6px 4px 4px;
}

.sel-card__tile {
  flex: none;
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.sel-card__tile--spot {
  background: #f3f3f2;
}
.sel-card__tile-glyph {
  display: flex;
  width: 40px;
  height: 40px;
}
.sel-card__tile-glyph :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
  /* Glyph occupies ~20 of the 44-unit viewBox — scale up so it reads as ~24px. */
  transform: scale(1.4);
}
.sel-card__tile-glyph :deep(svg > rect) {
  display: none;
}
.sel-card__tile-pin {
  width: 24px;
  height: 24px;
}
.sel-card__icon {
  width: 22px;
  height: 22px;
}

.sel-card__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sel-card__breadcrumb {
  color: rgba(15, 15, 15, 0.55);
  font-size: 12px;
  font-weight: 500;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
.sel-card__primary {
  font-size: 16px;
  font-weight: 600;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

.sel-card__actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  color: #0f0f0f;
}
.sel-card__btn {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  border-radius: 8px;
  transition: background 150ms;
}
.sel-card__btn:hover { background: rgba(0, 0, 0, 0.06); }
.sel-card__btn:active { background: rgba(0, 0, 0, 0.1); }
</style>
