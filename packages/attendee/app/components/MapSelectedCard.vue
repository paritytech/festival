<script setup lang="ts">
import { computed } from 'vue'
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
        <svg
          v-else
          class="sel-card__tile-pin"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1112 6.5a2.5 2.5 0 010 5z"
            fill="#0f0f0f"
          />
        </svg>
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
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M17 7H14C13.45 7 13 7.45 13 8C13 8.55 13.45 9 14 9H17C18.65 9 20 10.35 20 12C20 13.65 18.65 15 17 15H14C13.45 15 13 15.45 13 16C13 16.55 13.45 17 14 17H17C19.76 17 22 14.76 22 12C22 9.24 19.76 7 17 7ZM8 12C8 12.55 8.45 13 9 13H15C15.55 13 16 12.55 16 12C16 11.45 15.55 11 15 11H9C8.45 11 8 11.45 8 12ZM10 15H7C5.35 15 4 13.65 4 12C4 10.35 5.35 9 7 9H10C10.55 9 11 8.55 11 8C11 7.45 10.55 7 10 7H7C4.24 7 2 9.24 2 12C2 14.76 4.24 17 7 17H10C10.55 17 11 16.55 11 16C11 15.45 10.55 15 10 15Z"
              fill="currentColor"
            />
          </svg>
        </button>
        <button
          type="button"
          class="sel-card__btn"
          aria-label="Close"
          @click="$emit('close')"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M18.3 5.71a1 1 0 00-1.41 0L12 10.59 7.11 5.7a1 1 0 10-1.42 1.42L10.59 12l-4.9 4.89a1 1 0 101.42 1.42L12 13.41l4.89 4.9a1 1 0 001.41-1.42L13.41 12l4.89-4.87a1 1 0 000-1.42z"
              fill="currentColor"
            />
          </svg>
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
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sel-card__primary {
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
