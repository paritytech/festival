/**
 * Deterministic POAP / Festival Pass color from an SS58 address.
 * DJB2 hash mod 14. Same address → same color across every host.
 */
import { djb2 } from './hash'

export const FESTIVAL_COLORS = [
  '#C600AA', // magenta
  '#008AA1', // teal
  '#9462FA', // purple
  '#FF2670', // hot pink
  '#C6FFEA', // mint
  '#036843', // forest green
  '#F9FFD3', // cream yellow
  '#728806', // olive
  '#C52E00', // burnt red
  '#7365FF', // indigo
  '#F0EFFF', // lavender white
  '#FFD0F3', // pink light
  '#DBF5FF', // ice blue
  '#FFCECB', // peach
] as const

export function deriveFestivalColor(ss58Address: string): string {
  const index = Math.abs(djb2(ss58Address)) % FESTIVAL_COLORS.length
  return FESTIVAL_COLORS[index]!
}
