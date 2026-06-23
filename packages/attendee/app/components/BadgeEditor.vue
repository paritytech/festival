<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import IconClose from '~icons/ic/round-close'
import IconUndo from '~icons/ic/round-undo'
import IconEdit from '~icons/ic/round-edit'
import IconFill from '~icons/ic/round-format-color-fill'
import IconEraser from './EraserIcon.vue'
import {
  GRID_SIZE, PIXEL_COUNT, PALETTE,
  encodeBadgeHex, decodeBadgeHex, generateBadge,
  type EditorTool,
} from '@festival/shared/utils/badge'

const props = defineProps<{
  modelValue?: string
  title?: string
}>()

const emit = defineEmits<{
  done: [hex: string]
  close: []
}>()

// ── State ──

const backgroundColorIndex = ref(Math.floor(Math.random() * PALETTE.length))
const pixels = ref<number[]>(new Array(PIXEL_COUNT).fill(backgroundColorIndex.value))
const selectedColor = ref(0)
const activeTool = ref<EditorTool>('pencil')
const isDragging = ref(false)
const hasUserEdits = ref(false)
const showDiscardModal = ref(false)
const showToast = ref(false)

// Initialize from existing badge or random fill
if (props.modelValue) {
  pixels.value = decodeBadgeHex(props.modelValue)
  hasUserEdits.value = true
} else {
  // Pick first selected color different from background
  selectedColor.value = backgroundColorIndex.value === 0 ? 1 : 0
}

// ── Undo ──

const undoStack = ref<number[][]>([])
const canUndo = computed(() => undoStack.value.length > 0)

function pushUndo() {
  undoStack.value.push([...pixels.value])
  if (undoStack.value.length > 20) undoStack.value.shift()
}

function undo() {
  if (!canUndo.value) return
  pixels.value = undoStack.value.pop()!
}

// ── Painting ──

const gridRef = ref<HTMLElement | null>(null)

function getIndexFromEvent(e: MouseEvent | Touch): number {
  const el = gridRef.value
  if (!el) return -1
  const rect = el.getBoundingClientRect()
  const x = Math.floor(((e.clientX - rect.left) / rect.width) * GRID_SIZE)
  const y = Math.floor(((e.clientY - rect.top) / rect.height) * GRID_SIZE)
  if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return -1
  return y * GRID_SIZE + x
}

function paintAt(idx: number) {
  if (idx < 0 || idx >= PIXEL_COUNT) return
  pixels.value[idx] = activeTool.value === 'eraser' ? backgroundColorIndex.value : selectedColor.value
  pixels.value = [...pixels.value]
}

function floodFill(startIdx: number) {
  if (startIdx < 0 || startIdx >= PIXEL_COUNT) return
  const target = pixels.value[startIdx]
  const fill = activeTool.value === 'eraser' ? backgroundColorIndex.value : selectedColor.value
  if (target === fill) return
  pushUndo()
  const visited = new Set<number>()
  const stack = [startIdx]
  while (stack.length) {
    const idx = stack.pop()!
    if (visited.has(idx) || pixels.value[idx] !== target) continue
    visited.add(idx)
    pixels.value[idx] = fill
    const x = idx % GRID_SIZE, y = Math.floor(idx / GRID_SIZE)
    if (x > 0) stack.push(idx - 1)
    if (x < GRID_SIZE - 1) stack.push(idx + 1)
    if (y > 0) stack.push(idx - GRID_SIZE)
    if (y < GRID_SIZE - 1) stack.push(idx + GRID_SIZE)
  }
  pixels.value = [...pixels.value]
  hasUserEdits.value = true
}

function handlePointerDown(e: MouseEvent) {
  const idx = getIndexFromEvent(e)
  if (idx < 0) return
  if (activeTool.value === 'fill') { floodFill(idx); return }
  isDragging.value = true
  hasUserEdits.value = true
  pushUndo()
  paintAt(idx)
}

function handlePointerMove(e: MouseEvent) {
  if (isDragging.value) {
    const idx = getIndexFromEvent(e)
    if (idx >= 0) paintAt(idx)
  }
}

function handlePointerUp() { isDragging.value = false }

function handleTouchStart(e: TouchEvent) {
  e.preventDefault()
  const t = e.touches[0]; if (!t) return
  const idx = getIndexFromEvent(t)
  if (idx < 0) return
  if (activeTool.value === 'fill') { floodFill(idx); return }
  isDragging.value = true
  hasUserEdits.value = true
  pushUndo()
  paintAt(idx)
}

function handleTouchMove(e: TouchEvent) {
  e.preventDefault()
  const t = e.touches[0]; if (!t || !isDragging.value) return
  const idx = getIndexFromEvent(t)
  if (idx >= 0) paintAt(idx)
}

function handleTouchEnd(e: TouchEvent) { e.preventDefault(); isDragging.value = false }

onMounted(() => { window.addEventListener('mouseup', handlePointerUp) })
onUnmounted(() => { window.removeEventListener('mouseup', handlePointerUp) })

// ── Randomize ──

function randomize() {
  pushUndo()
  pixels.value = generateBadge(props.title || 'badge', undefined, Math.random().toString(36).slice(2))
  hasUserEdits.value = true
  showToast.value = true
}

// ── Close / Done ──

function handleClose() {
  if (hasUserEdits.value) {
    showDiscardModal.value = true
  } else {
    emit('close')
  }
}

function confirmDiscard() {
  showDiscardModal.value = false
  emit('close')
}

function handleDone() {
  emit('done', encodeBadgeHex(pixels.value))
}

// ── Tool label ──

const toolLabel = computed(() => {
  const labels: Record<EditorTool, string> = { pencil: 'PENCIL SELECTED', fill: 'FILL SELECTED', eraser: 'ERASER SELECTED' }
  return labels[activeTool.value]
})

// ── Grid line color ──

const gridBgColor = computed(() => {
  // Slightly darken the dominant color for grid lines
  const dominant = PALETTE[backgroundColorIndex.value]
  return dominant + '80' // 50% opacity overlay
})
</script>

<template>
  <div class="fixed inset-0 md:left-[var(--col-l)] md:right-[var(--col-r)] bg-background flex flex-col z-[60] pt-[var(--safe-top)]">
    <!-- Discard modal -->
    <ConfirmModal
      :visible="showDiscardModal"
      title="Discard changes?"
      message="If you leave your changes won't be saved"
      confirm-label="Leave"
      @confirm="confirmDiscard"
      @cancel="showDiscardModal = false"
    />

    <!-- Header -->
    <div class="px-4 pt-4 pb-3 flex items-center">
      <button class="w-10 h-10 flex items-center justify-center -ml-2" @click="handleClose">
        <IconClose class="w-6 h-6 text-white" />
      </button>
      <h1 class="flex-1 text-center text-base font-semibold text-white">Create Badge</h1>
      <button
        v-if="hasUserEdits"
        data-testid="badge-editor-done"
        class="px-4 py-1.5 bg-white text-black rounded-full text-sm font-medium"
        @click="handleDone"
      >
        Done
      </button>
      <div v-else class="w-16" />
    </div>

    <!-- Tool row: Undo + Randomize -->
    <div class="px-4 flex items-center justify-between mb-3">
      <button
        class="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center transition-opacity"
        :class="{ 'opacity-30': !canUndo }"
        :disabled="!canUndo"
        @click="undo"
      >
        <IconUndo class="w-[22px] h-[22px] text-white" />
      </button>
      <button
        data-testid="badge-editor-random"
        class="px-4 h-12 rounded-full bg-surface-2 text-white text-sm font-medium"
        @click="randomize"
      >
        Random
      </button>
    </div>

    <!-- Canvas -->
    <div class="px-4 mb-4">
      <div
        ref="gridRef"
        class="grid w-full select-none rounded-2xl overflow-hidden"
        :style="{
          gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)`,
          gap: '1px',
          background: gridBgColor,
          cursor: 'crosshair',
          touchAction: 'none',
        }"
        @mousedown="handlePointerDown"
        @mousemove="handlePointerMove"
        @touchstart="handleTouchStart"
        @touchmove="handleTouchMove"
        @touchend="handleTouchEnd"
      >
        <div
          v-for="i in PIXEL_COUNT"
          :key="i - 1"
          class="aspect-square"
          :style="{ backgroundColor: PALETTE[pixels[i - 1]] }"
        />
      </div>
    </div>

    <!-- Palette -->
    <div class="px-4 mb-3">
      <div class="flex flex-wrap justify-center gap-2.5">
        <button
          v-for="(color, idx) in PALETTE"
          :key="idx"
          class="w-10 h-10 rounded-full border-2 transition-transform"
          :class="selectedColor === idx ? 'scale-110 border-white shadow-lg' : 'border-transparent'"
          :style="{ backgroundColor: color }"
          @click="selectedColor = idx; if (activeTool === 'eraser') activeTool = 'pencil'"
        />
      </div>
    </div>

    <!-- Tool label -->
    <p class="text-center text-xs font-semibold text-white tracking-widest mb-3">
      {{ toolLabel }}
    </p>

    <!-- Bottom toolbar -->
    <div class="flex items-center justify-around px-12 mt-auto pb-[calc(var(--safe-bottom)+16px)]">
      <!-- Pencil -->
      <button
        class="w-14 h-14 rounded-full flex items-center justify-center transition-colors"
        :class="activeTool === 'pencil' ? 'bg-white' : 'bg-surface-2'"
        @click="activeTool = 'pencil'"
      >
        <IconEdit class="w-6 h-6" :class="activeTool === 'pencil' ? 'text-black' : 'text-white'" />
      </button>
      <!-- Fill -->
      <button
        class="w-14 h-14 rounded-full flex items-center justify-center transition-colors"
        :class="activeTool === 'fill' ? 'bg-white' : 'bg-surface-2'"
        @click="activeTool = 'fill'"
      >
        <IconFill class="w-6 h-6" :class="activeTool === 'fill' ? 'text-black' : 'text-white'" />
      </button>
      <!-- Eraser -->
      <button
        class="w-14 h-14 rounded-full flex items-center justify-center transition-colors"
        :class="activeTool === 'eraser' ? 'bg-white' : 'bg-surface-2'"
        @click="activeTool = 'eraser'"
      >
        <IconEraser class="w-6 h-6" :class="activeTool === 'eraser' ? 'text-black' : 'text-white'" />
      </button>
    </div>

    <!-- Toast -->
    <div class="absolute bottom-28 left-4 right-4">
      <SuccessToast
        :visible="showToast"
        message="Magic happened! Badge Generated!"
        @hide="showToast = false"
      />
    </div>
  </div>
</template>
