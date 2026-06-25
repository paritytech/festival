import { djb2 } from './hash'

export const GRID_SIZE = 16
export const PIXEL_COUNT = GRID_SIZE * GRID_SIZE

/** 14-color palette. No transparent, no white, no black */
export const PALETTE = [
  '#C600AA',  // 0  magenta
  '#008AA1',  // 1  teal
  '#9462FA',  // 2  purple
  '#FF2670',  // 3  hot pink
  '#C6FFEA',  // 4  mint
  '#036843',  // 5  forest green
  '#F9FFD3',  // 6  cream yellow
  '#728806',  // 7  olive
  '#C52E00',  // 8  burnt red
  '#7365FF',  // 9  indigo
  '#F0EFFF',  // 10 lavender white
  '#FFD0F3',  // 11 pink light
  '#DBF5FF',  // 12 ice blue
  '#FFCECB',  // 13 peach
] as const

/** Encode pixel array (256 values 0..15) to 128-char hex string */
export function encodeBadgeHex(pixels: number[]): string {
  const chars: string[] = []
  for (let i = 0; i < PIXEL_COUNT; i += 2) {
    const high = pixels[i] & 0xf
    const low = (pixels[i + 1] ?? 0) & 0xf
    const byte = (high << 4) | low
    chars.push(byte.toString(16).padStart(2, '0'))
  }
  return chars.join('')
}

/** Decode hex string to pixel array (256 values 0..15) */
export function decodeBadgeHex(hex: string): number[] {
  const pixels: number[] = []
  for (let i = 0; i < hex.length; i += 2) {
    const byte = parseInt(hex.slice(i, i + 2), 16)
    pixels.push((byte >> 4) & 0xf)
    pixels.push(byte & 0xf)
  }
  while (pixels.length < PIXEL_COUNT) pixels.push(0)
  return pixels.slice(0, PIXEL_COUNT)
}

// --- Generative badge ---

/** mulberry32 PRNG */
function mulberry32(seed: number) {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Vibrant color pairs: [primary (background), accent (shapes)] */
const COLOR_PAIRS: [number, number][] = [
  [0, 3],   // magenta + hot pink
  [3, 0],   // hot pink + magenta
  [1, 4],   // teal + mint
  [4, 1],   // mint + teal
  [2, 9],   // purple + indigo
  [9, 2],   // indigo + purple
  [5, 4],   // forest green + mint
  [4, 5],   // mint + forest green
  [0, 11],  // magenta + pink light
  [9, 10],  // indigo + lavender white
]

/** Light accent colors for shapes (contrast well on most backgrounds) */
const LIGHT_ACCENTS = [4, 6, 10, 11, 12, 13] // mint, cream, lavender, pink light, ice blue, peach

/** Place a rectangle on the pixel grid, clipping to bounds. */
function fillRect(pixels: number[], x: number, y: number, w: number, h: number, color: number) {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const px = x + dx
      const py = y + dy
      if (px >= 0 && px < GRID_SIZE && py >= 0 && py < GRID_SIZE) {
        pixels[py * GRID_SIZE + px] = color
      }
    }
  }
}

/**
 * Generate a deterministic geometric badge.
 * Uses bold rectangles on a solid background for a modern block-art look.
 * @param title - Session title (used as seed)
 * @param _category - Deprecated, ignored. Kept for call-site compatibility.
 * @param salt - Extra seed material (e.g. user account address for uniqueness)
 */
export function generateBadge(title: string, _category?: string, salt = ''): number[] {
  const seed = djb2((title || 'untitled') + salt) >>> 0
  const rand = mulberry32(seed)

  // Pick a random vibrant color pair from the seed
  const [primary, accent] = COLOR_PAIRS[Math.floor(rand() * COLOR_PAIRS.length)]

  // Pick a light accent that differs from primary and accent
  let lightAccent = LIGHT_ACCENTS[Math.floor(rand() * LIGHT_ACCENTS.length)]
  if (lightAccent === primary || lightAccent === accent) {
    lightAccent = LIGHT_ACCENTS[(LIGHT_ACCENTS.indexOf(lightAccent) + 1) % LIGHT_ACCENTS.length]
  }

  // Fill background with primary
  const pixels = new Array<number>(PIXEL_COUNT).fill(primary)

  // Place 4-7 bold rectangles
  const numRects = 4 + Math.floor(rand() * 4)
  const shapeColors = [accent, lightAccent, lightAccent] // light-biased for contrast

  for (let i = 0; i < numRects; i++) {
    const color = shapeColors[Math.floor(rand() * shapeColors.length)]
    const w = 3 + Math.floor(rand() * 5) // 3-7 wide
    const h = 2 + Math.floor(rand() * 5) // 2-6 tall
    // Allow edge bleed: start from -1 so shapes clip at borders
    const x = -1 + Math.floor(rand() * (GRID_SIZE - 1))
    const y = -1 + Math.floor(rand() * (GRID_SIZE - 1))
    fillRect(pixels, x, y, w, h, color)
  }

  return pixels
}

/** Return the hex color of the most frequent pixel color in a badge. */
export function getDominantBadgeColor(pixels: number[]): string {
  const counts = new Array(PALETTE.length).fill(0)
  for (const idx of pixels) {
    if (idx >= 0 && idx < PALETTE.length) counts[idx]++
  }
  let maxIdx = 0
  let maxCount = 0
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > maxCount) { maxCount = counts[i]; maxIdx = i }
  }
  return PALETTE[maxIdx] as string
}

export type EditorTool = 'pencil' | 'eraser' | 'fill'
