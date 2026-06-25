<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
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
  'update:modelValue': [hex: string]
}>()

// ── State ──

const backgroundColorIndex = ref(Math.floor(Math.random() * PALETTE.length))
const pixels = ref<number[]>(new Array(PIXEL_COUNT).fill(backgroundColorIndex.value))
const selectedColor = ref(backgroundColorIndex.value === 0 ? 1 : 0)
const activeTool = ref<EditorTool>('pencil')
const isDragging = ref(false)

// Initialize from existing badge or random fill
if (props.modelValue) {
  pixels.value = decodeBadgeHex(props.modelValue)
} else {
  pixels.value = generateBadge(props.title || 'badge', undefined)
  emitHex()
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
  emitHex()
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
  emitHex()
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
  emitHex()
}

function handlePointerDown(e: MouseEvent) {
  const idx = getIndexFromEvent(e)
  if (idx < 0) return
  if (activeTool.value === 'fill') { floodFill(idx); return }
  isDragging.value = true
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

function randomize() {
  pushUndo()
  pixels.value = generateBadge(props.title || 'badge', undefined, Math.random().toString(36).slice(2))
  emitHex()
}

function emitHex() { emit('update:modelValue', encodeBadgeHex(pixels.value)) }

const gridBgColor = computed(() => PALETTE[backgroundColorIndex.value] + '80')

const toolLabel = computed(() => {
  const labels: Record<EditorTool, string> = { pencil: 'PENCIL SELECTED', fill: 'FILL SELECTED', eraser: 'ERASER SELECTED' }
  return labels[activeTool.value]
})
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- Top row: Undo + Randomize -->
    <div class="flex items-center justify-between">
      <button
        class="w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center transition-opacity"
        :class="{ 'opacity-30': !canUndo }"
        :disabled="!canUndo"
        @click="undo"
      >
        <IconUndo class="w-[18px] h-[18px] text-white" />
      </button>
      <button
        class="px-4 h-10 rounded-full bg-surface-2 text-white text-sm font-medium"
        @click="randomize"
      >
        Random
      </button>
    </div>

    <!-- Canvas -->
    <div
      ref="gridRef"
      class="grid w-full select-none rounded-lg overflow-hidden"
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

    <!-- Palette -->
    <div class="flex flex-wrap gap-1.5">
      <button
        v-for="(color, idx) in PALETTE"
        :key="idx"
        class="w-7 h-7 rounded-full border-2 transition-transform"
        :class="selectedColor === idx ? 'scale-110 border-white shadow-md' : 'border-transparent'"
        :style="{ backgroundColor: color }"
        @click="selectedColor = idx; if (activeTool === 'eraser') activeTool = 'pencil'"
      />
    </div>

    <!-- Tool label -->
    <p class="text-center text-[10px] font-semibold text-text-secondary tracking-widest">
      {{ toolLabel }}
    </p>

    <!-- Bottom toolbar -->
    <div class="flex items-center justify-center gap-4">
      <!-- Pencil -->
      <button
        class="w-10 h-10 rounded-full flex items-center justify-center transition-colors"
        :class="activeTool === 'pencil' ? 'bg-white' : 'bg-surface-2'"
        @click="activeTool = 'pencil'"
      >
        <IconEdit class="w-[18px] h-[18px]" :class="activeTool === 'pencil' ? 'text-black' : 'text-white'" />
      </button>
      <!-- Fill -->
      <button
        class="w-10 h-10 rounded-full flex items-center justify-center transition-colors"
        :class="activeTool === 'fill' ? 'bg-white' : 'bg-surface-2'"
        @click="activeTool = 'fill'"
      >
        <IconFill class="w-[18px] h-[18px]" :class="activeTool === 'fill' ? 'text-black' : 'text-white'" />
      </button>
      <!-- Eraser -->
      <button
        class="w-10 h-10 rounded-full flex items-center justify-center transition-colors"
        :class="activeTool === 'eraser' ? 'bg-white' : 'bg-surface-2'"
        @click="activeTool = 'eraser'"
      >
        <IconEraser class="w-[18px] h-[18px]" :class="activeTool === 'eraser' ? 'text-black' : 'text-white'" />
      </button>
    </div>
  </div>
</template>
