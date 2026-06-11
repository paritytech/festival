<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { MOCK_VENUE_MAP } from '@festival/shared/mocks'
import { usePoaps } from '~/composables/usePoaps'
import { useSubEvents } from '~/composables/useSubEvents'
import { useFestival } from '~/composables/useFestival'
import { getDominantBadgeColor } from '@festival/shared/utils/badge'
import { deriveFestivalColor } from '@festival/shared/utils/festivalColor'
import { shortenAddress } from '@festival/shared/utils/address'
import FestivalPoapBadge from '~/components/FestivalPoapBadge.vue'
import { resolveLocationLabel } from '@festival/shared/venue/floors'
import { hasDeployedContracts } from '@festival/shared/contracts/festival-reads'
import { formatTimeBerlin, formatDateBerlin } from '@festival/shared/utils/time'
import {
  createBadge3D, generateEdgeColors, hexToRgb, darkenRgb,
  type Badge3DInstance,
} from '@festival/shared/utils/badge-3d'

definePageMeta({
  validate: (route) => {
    const n = Number(route.params.tokenId)
    return Number.isInteger(n) && n > 0
  },
})

const router = useRouter()
const route = useRoute()
const tokenId = Number(route.params.tokenId)
const poapContract = (route.query.contract as string) || ''

const { getById, isLoading: poapsLoading, poaps } = usePoaps()
const { subEvents } = useSubEvents()
const { metadata: festivalMetadata } = useFestival()

const poap = computed(() => getById(poapContract, tokenId))

watch(
  [poaps, poapsLoading],
  ([, loading]) => {
    if (loading) return
    if (!poap.value) {
      navigateTo('/', { replace: true })
    }
  },
  { immediate: true },
)

const subEvent = computed(() => {
  if (!poap.value || poap.value.type !== 'sub-event') return null
  return subEvents.value.find(
    se => se.address.toLowerCase() === poap.value!.sourceContract.toLowerCase(),
  ) || null
})

const venueMarkers = computed(() => {
  if (hasDeployedContracts() && festivalMetadata.value?.venueMap?.markers?.length) {
    return festivalMetadata.value.venueMap.markers
  }
  return MOCK_VENUE_MAP.markers
})

// ── Display data ──

const dominantColor = computed(() => {
  if (!poap.value) return '#1c1917'
  // Festival POAPs use the deterministic palette color so the 3D card edges
  // tonally match the front-face badge.
  if (poap.value.type === 'festival') return deriveFestivalColor(poap.value.attendee || '')
  if (!poap.value.badgePixels) return '#1c1917' // stone-900 for image-based POAPs
  return getDominantBadgeColor(poap.value.badgePixels)
})

const hostedBy = computed(() => {
  if (!subEvent.value) return ''
  const speakers = subEvent.value.metadata.speakers?.filter(Boolean) ?? []
  const label = speakers.length
    ? speakers.join(', ')
    : shortenAddress(subEvent.value.creator)
  return `Hosted by ${label}`
})

const timeAndLocation = computed(() => {
  if (!subEvent.value) return ''
  const start = new Date(subEvent.value.startTime * 1000)
  const end = new Date(subEvent.value.endTime * 1000)
  const dayAndMonth = formatDateBerlin(start, { day: 'numeric', month: 'long' })
  const fromTime = formatTimeBerlin(start)
  const toTime = formatTimeBerlin(end)
  let label = `${dayAndMonth} · ${fromTime}–${toTime}`
  if (subEvent.value.metadata.location) {
    const loc = resolveLocationLabel(subEvent.value.metadata.location, venueMarkers.value)
    if (loc) label += ` ${loc}`
  }
  return label
})

const receivedDate = computed(() => {
  if (!poap.value) return ''
  const d = new Date(poap.value.issuedAt * 1000)
  const dayAndMonth = formatDateBerlin(d, { day: 'numeric', month: 'long' })
  const time = formatTimeBerlin(d)
  return `Received: ${dayAndMonth}, ${time}`
})

// ── 3D card ──

const EDGE_LAYERS = 13
const EDGE_DEPTH = 6 // px from center to face

const stageRef = ref<HTMLElement | null>(null)
const badgeRef = ref<HTMLElement | null>(null)
const shineRef = ref<HTMLElement | null>(null)

const edgeSlabStyles = computed(() => {
  const frontRgb = hexToRgb(dominantColor.value)
  const backRgb = darkenRgb(frontRgb, 0.45)
  const colors = generateEdgeColors(frontRgb, backRgb, EDGE_LAYERS)
  return colors.map((bg, i) => {
    const t = i / (EDGE_LAYERS - 1)
    const z = EDGE_DEPTH - t * (EDGE_DEPTH * 2)
    return {
      background: bg,
      transform: `translateZ(${z.toFixed(2)}px)`,
    }
  })
})

const backFaceColor = computed(() => {
  const rgb = hexToRgb(dominantColor.value)
  const dark = darkenRgb(rgb, 0.3)
  return `rgb(${dark[0]},${dark[1]},${dark[2]})`
})

const backTextColor = computed(() => {
  const rgb = hexToRgb(dominantColor.value)
  // Light version for text on dark back
  return `rgb(${Math.min(255, rgb[0] + 100)},${Math.min(255, rgb[1] + 100)},${Math.min(255, rgb[2] + 100)})`
})

let badge3d: Badge3DInstance | null = null

onMounted(() => {
  if (stageRef.value && badgeRef.value) {
    badge3d = createBadge3D({
      stage: stageRef.value,
      badge: badgeRef.value,
      shine: shineRef.value,
    })
  }
})

onUnmounted(() => {
  badge3d?.destroy()
})
</script>

<template>
  <div class="flex flex-col min-h-[calc(100dvh-var(--safe-top)-var(--safe-bottom)-68px)] -mx-4">
    <!-- Header: back only -->
    <div class="px-4 pt-4 pb-3">
      <button class="w-10 h-10 flex items-center justify-center -ml-2" @click="router.back()">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-white">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
    </div>

    <template v-if="poap">
      <!-- Centered 3D badge + info -->
      <div class="flex-1 flex flex-col items-center justify-center px-6">
        <!-- 3D stage -->
        <div
          ref="stageRef"
          class="flex justify-center items-center py-4"
          style="perspective: 1400px; perspective-origin: 50% 40%; touch-action: none; cursor: grab;"
        >
          <!-- Badge wrapper (preserve-3d) -->
          <div
            ref="badgeRef"
            class="w-[60vw] max-w-[240px] aspect-square relative"
            style="transform-style: preserve-3d;"
          >
            <!-- Edge slabs (thickness illusion) -->
            <div
              v-for="(style, i) in edgeSlabStyles"
              :key="i"
              class="absolute inset-0 rounded-[24px]"
              :style="{ background: style.background, transform: style.transform }"
            />

            <!-- Front face -->
            <div
              class="absolute inset-0 rounded-[24px] overflow-hidden"
              :style="{ transform: `translateZ(${EDGE_DEPTH}px)`, backfaceVisibility: 'hidden' }"
            >
              <!-- Artwork -->
              <FestivalPoapBadge
                v-if="poap.type === 'festival'"
                :address="poap.attendee"
              />
              <BadgeCanvas
                v-else-if="poap.badgePixels"
                :pixels="poap.badgePixels"
                :size="280"
                class="w-full h-full rounded-[24px]"
              />
              <img
                v-else-if="poap.poapImageUrl"
                :src="poap.poapImageUrl"
                alt="Badge"
                class="w-full h-full object-cover rounded-[24px]"
              />
              <!-- Shine overlay -->
              <div
                ref="shineRef"
                class="absolute inset-0 pointer-events-none rounded-[24px]"
                style="mix-blend-mode: screen; opacity: 0.9;"
              />
            </div>

            <!-- Back face -->
            <div
              class="absolute inset-0 rounded-[24px] flex flex-col items-center justify-center px-5 text-center"
              :style="{
                transform: `translateZ(-${EDGE_DEPTH}px) rotateY(180deg)`,
                backfaceVisibility: 'hidden',
                background: backFaceColor,
                color: backTextColor,
              }"
            >
              <p class="text-[10px] tracking-widest opacity-70 mb-1.5 uppercase">
                {{ poap.type === 'festival' ? 'FESTIVAL BADGE' : 'SESSION BADGE' }}
              </p>
              <p class="text-sm font-medium mb-1">{{ poap.sourceName }}</p>
              <p v-if="timeAndLocation" class="text-[10px] opacity-70">{{ timeAndLocation }}</p>
              <div class="w-12 h-px my-3" :style="{ background: backTextColor + '40' }" />
              <p class="text-[9px] tracking-widest opacity-50 uppercase">#{{ String(poap.tokenId).padStart(4, '0') }}</p>
            </div>
          </div>
        </div>

        <!-- Name -->
        <h1 class="text-2xl font-bold text-white text-center mt-4">
          {{ poap.sourceName }}
        </h1>

        <!-- Hosted by -->
        <p v-if="hostedBy" class="text-sm text-text-muted text-center mt-2">
          {{ hostedBy }}
        </p>

        <!-- Time + location -->
        <p v-if="timeAndLocation" class="text-sm text-text-muted text-center mt-1">
          {{ timeAndLocation }}
        </p>
      </div>

      <!-- Received date (bottom) -->
      <div class="px-4 pb-6 pt-4">
        <p class="text-sm text-text-muted text-center">{{ receivedDate }}</p>
      </div>
    </template>
  </div>
</template>
