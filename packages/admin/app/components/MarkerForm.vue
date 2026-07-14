<script setup lang="ts">
import { reactive, computed, watch } from 'vue'
import type { VenueMarker, VenueZone, MarkerCategory, MarkerType } from '@festival/shared/metadata/schemas'
import { CATEGORIES, TYPES_BY_CATEGORY, TYPE_LABELS, normalizeCategory, normalizeType } from '@festival/shared/venue/categories'
import { getMarkerIcon } from '@festival/shared/venue/icons'
import { zonesForFloor } from '@festival/shared/venue/zones'

const props = defineProps<{
  marker: VenueMarker
  zones: VenueZone[]
}>()

const emit = defineEmits<{
  save: [marker: VenueMarker]
  cancel: []
  /** Fires on every form mutation so the parent can render a live preview
   *  of the in-progress marker on the map. Deep-watched. */
  update: [marker: VenueMarker]
}>()

// Coerce legacy markers (missing/unknown category) to valid values so the picker starts on a real choice.
const initialCategory = normalizeCategory(props.marker.category)
const form = reactive<VenueMarker>({
  ...props.marker,
  category: initialCategory,
  type: normalizeType(initialCategory, props.marker.type),
})

// Sync x/y/floor/zone when parent updates (e.g. from a map click while form is open).
watch(() => [props.marker.x, props.marker.y, props.marker.floorId, props.marker.zoneId], ([x, y, floorId, zoneId]) => {
  form.x = x as number
  form.y = y as number
  form.floorId = floorId as string
  form.zoneId = zoneId as string | undefined
})

const categories = computed<MarkerCategory[]>(() => Object.keys(CATEGORIES) as MarkerCategory[])
const typesForCategory = computed<readonly MarkerType[]>(() => TYPES_BY_CATEGORY[form.category])
const previewIcon = computed(() => getMarkerIcon(form.category, form.type))
const categorySpec = computed(() => CATEGORIES[form.category])
const zonesOnFloor = computed(() => zonesForFloor(form.floorId, props.zones))

// If the user changes category, pick the first type in that category by default.
watch(() => form.category, (cat) => {
  const types = TYPES_BY_CATEGORY[cat]
  if (!types.includes(form.type)) form.type = types[0]!
})

// Live preview: emit a snapshot on every form change so the map can render the
// in-progress marker. The category/type-default sync above also mutates `form`,
// but both land in one watcher tick so the parent only sees the final state.
watch(form, (next) => emit('update', { ...next }), { deep: true })

const isNew = computed(() => !props.marker.label)
const isIdLocked = computed(() => isNew.value)

function handleSubmit() {
  if (!form.id) return
  if (categorySpec.value.hasLabel && !form.label) return
  emit('save', { ...form })
}

function categoryLabel(cat: MarkerCategory): string {
  return cat.charAt(0).toUpperCase() + cat.slice(1)
}
</script>

<template>
  <div class="bg-surface border border-border rounded-md p-5">
    <div class="flex items-center gap-3 mb-4">
      <!-- Live icon preview -->
      <div class="marker-preview" v-html="previewIcon" />
      <h3 class="font-medium">{{ isNew ? 'Add Marker' : 'Edit Marker' }}</h3>
    </div>

    <div class="space-y-4">
      <!-- Category picker -->
      <div>
        <label class="block text-sm font-medium mb-2">Category</label>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="cat in categories"
            :key="cat"
            type="button"
            class="cat-pill"
            :class="{ 'is-active': form.category === cat }"
            :style="form.category === cat ? { background: CATEGORIES[cat].color, borderColor: CATEGORIES[cat].color } : undefined"
            @click="form.category = cat"
          >
            {{ categoryLabel(cat) }}
          </button>
        </div>
      </div>

      <!-- Type picker (filtered to the chosen category) -->
      <div>
        <label class="block text-sm font-medium mb-2">Type</label>
        <div class="grid grid-cols-2 gap-2 md:flex md:flex-wrap">
          <button
            v-for="t in typesForCategory"
            :key="t"
            type="button"
            class="type-pill w-full md:w-auto"
            :class="{ 'is-active': form.type === t }"
            @click="form.type = t"
          >
            {{ TYPE_LABELS[t] }}
          </button>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium mb-1">Label <span v-if="categorySpec.hasLabel">*</span></label>
          <input
            v-model="form.label"
            type="text"
            class="w-full px-3 py-2 border border-border rounded-md text-sm bg-surface-elevated focus:outline-none focus:border-primary"
            :placeholder="categorySpec.hasLabel ? TYPE_LABELS[form.type] : '(optional — icon-only category)'"
          />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">ID</label>
          <input
            v-model="form.id"
            type="text"
            :readonly="isIdLocked"
            class="w-full px-3 py-2 border border-border rounded-xl text-sm font-mono focus:outline-none focus:border-primary"
            :class="isIdLocked ? 'bg-background text-text-muted' : 'bg-surface-2'"
            placeholder="main-stage"
          />
        </div>
      </div>

      <div class="grid grid-cols-3 gap-4">
        <div>
          <label class="block text-sm font-medium mb-1">X</label>
          <input
            :value="form.x"
            type="number"
            readonly
            class="w-full px-3 py-2 border border-border rounded-md text-sm bg-background font-mono text-text-muted"
          />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Y</label>
          <input
            :value="form.y"
            type="number"
            readonly
            class="w-full px-3 py-2 border border-border rounded-md text-sm bg-background font-mono text-text-muted"
          />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Floor</label>
          <input
            :value="form.floorId"
            type="text"
            readonly
            class="w-full px-3 py-2 border border-border rounded-md text-sm bg-background font-mono text-text-muted"
          />
        </div>
      </div>

      <!-- Zone (optional, filtered to the current floor) -->
      <div>
        <label class="block text-sm font-medium mb-1">Zone <span class="text-text-muted font-normal">(optional)</span></label>
        <select
          v-model="form.zoneId"
          class="w-full px-3 py-2 border border-border rounded-md text-sm bg-surface-elevated"
        >
          <option :value="undefined">— no zone —</option>
          <option v-for="z in zonesOnFloor" :key="z.id" :value="z.id">{{ z.label }} ({{ z.id }})</option>
        </select>
      </div>

      <p class="text-xs text-text-muted">
        Tip: click the map to move this marker; zone auto-fills when you click inside a colored region.
      </p>

      <div class="flex gap-2 pt-2">
        <button
          class="px-4 py-2 bg-primary text-black rounded-2xl text-sm hover:bg-primary-hover transition-colors disabled:opacity-50"
          :disabled="!form.id || (categorySpec.hasLabel && !form.label)"
          @click="handleSubmit"
        >
          {{ isNew ? 'Add Marker' : 'Save Changes' }}
        </button>
        <button
          class="px-4 py-2 bg-secondary-btn rounded-2xl text-sm text-text-secondary hover:bg-secondary-btn-hover hover:text-text-primary transition-colors"
          @click="emit('cancel')"
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.marker-preview {
  width: 40px;
  height: 40px;
  display: inline-flex;
}
.marker-preview :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}

.cat-pill {
  padding: 6px 14px;
  border-radius: 9999px;
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 150ms, color 150ms, border-color 150ms;
}
.cat-pill:hover { border-color: rgba(255, 255, 255, 0.3); }
.cat-pill.is-active { color: #fff; }

.type-pill {
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: background 150ms, color 150ms, border-color 150ms;
  text-align: center;
  white-space: normal;
  line-height: 1.3;
}
.type-pill:hover { background: rgba(255, 255, 255, 0.04); }
.type-pill.is-active {
  border-color: rgba(255, 255, 255, 0.5);
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}
</style>
