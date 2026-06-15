import { ref, computed, watch } from 'vue'
import { FESTIVAL_ADDRESS } from '@festival/shared/contracts/addresses'
import { useWalletStore } from '@festival/shared/host/wallet'
import { walletAddressToH160 } from '@festival/shared/utils/address'
import { getCachedMetadata, setCachedMetadata } from '@festival/shared/cache/cid-cache'
import { isInHost } from '@festival/shared/host/detect'
import { festivalState, type PoapEntry, type SessionEntry } from '@festival/shared/cache/festival-state'
import { bootLoadAttendee } from './useBootLoad'

export interface PoapToken {
  tokenId: number
  poapContract: string
  sourceContract: string
  sourceName: string
  attendee: string
  issuedAt: number
  badgePixels?: number[]
  poapImageUrl?: string
  type: 'festival' | 'sub-event'
}

// Per-festival image URL cache (resolved off-chain via Bulletin/IPFS).
// Tracked separately from chain state because the resolution is async and
// can take longer than the chain reads.
const festivalPoapImageUrl = ref<string | undefined>(undefined)

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

async function cacheImageAsDataUrl(
  imageCid: string,
  resolveImageUrl: (cid: string) => string,
  resolveImageBlob: (cid: string) => Promise<string | null>,
) {
  try {
    let blob: Blob | null = null
    if (isInHost()) {
      const blobUrl = await resolveImageBlob(imageCid)
      if (blobUrl) {
        const resp = await fetch(blobUrl)
        blob = await resp.blob()
        URL.revokeObjectURL(blobUrl)
      }
    } else {
      const url = resolveImageUrl(imageCid)
      const resp = await fetch(url)
      if (resp.ok) blob = await resp.blob()
    }
    if (blob) {
      const dataUrl = await blobToDataUrl(blob)
      await setCachedMetadata(`img:${imageCid}`, dataUrl)
    }
  } catch (e) {
    console.warn('[usePoaps] background image caching failed:', e)
  }
}

/**
 * Resolve the festival POAP image URL once metadata is available. Triggered
 * via watcher on `festivalState.festival?.metadata` so it follows boot/reload.
 * The resolved URL is shared across all festival POAP tokens.
 */
async function resolveFestivalPoapImage(imageCid: string): Promise<string | undefined> {
  const cached = await getCachedMetadata<string>(`img:${imageCid}`)
  if (cached) return cached

  const { useBulletinStorage } = await import('@festival/shared/metadata/bulletin')
  const { resolveImageUrl, resolveImageBlob, resolveDisplayImageUrl } = useBulletinStorage()

  // Blob URL via the preimage manager in the host, gateway URL standalone.
  const url = (await resolveDisplayImageUrl(imageCid)) ?? undefined
  // Cache a data URL in the background for offline use.
  cacheImageAsDataUrl(imageCid, resolveImageUrl, resolveImageBlob)
  return url
}

let imageWatchInstalled = false
function installFestivalImageWatcher() {
  if (imageWatchInstalled) return
  imageWatchInstalled = true
  watch(
    () => festivalState.festival?.metadata?.festivalPoapImage,
    async (cid) => {
      if (!cid) {
        festivalPoapImageUrl.value = undefined
        return
      }
      festivalPoapImageUrl.value = await resolveFestivalPoapImage(cid)
    },
    { immediate: true },
  )
}

function findSessionByPoapEntry(entry: PoapEntry): SessionEntry | undefined {
  const tokenLower = entry.tokenId
  return festivalState.sessions.find((s) => s.poapTokenIds.includes(tokenLower))
}

/**
 * POAPs composable. Reads from `festivalState.user.festivalPoaps` and
 * `festivalState.user.sessionPoaps`. Names/categories/badges come from
 * the festival metadata or the matching session entry.
 */
export function usePoaps() {
  installFestivalImageWatcher()

  const poaps = computed<PoapToken[]>(() => {
    const festName = festivalState.festival?.metadata?.name || 'Festival'
    const userAddress = festivalState.user.address ?? ''

    const fest = festivalState.user.festivalPoaps.map<PoapToken>((p) => ({
      tokenId: Number(p.tokenId),
      poapContract: p.poapContract,
      sourceContract: FESTIVAL_ADDRESS,
      sourceName: festName,
      attendee: userAddress,
      issuedAt: Number(p.data.issuedAt),
      poapImageUrl: festivalPoapImageUrl.value,
      type: 'festival',
    }))

    const sub = festivalState.user.sessionPoaps
      .filter((p) => !findSessionByPoapEntry(p)?.details.cancelled)
      .map<PoapToken>((p) => {
        const session = findSessionByPoapEntry(p)
        const meta = session?.metadata
        return {
          tokenId: Number(p.tokenId),
          poapContract: p.poapContract,
          sourceContract: session?.address ?? p.data.sourceContract,
          sourceName: meta?.name || `Sub-Event ${(session?.address ?? '').slice(0, 8)}`,
          attendee: userAddress,
          issuedAt: Number(p.data.issuedAt),
          badgePixels: meta?.badgePixels,
          type: 'sub-event',
        }
      })

    return [...fest, ...sub]
  })

  const festivalPoaps = computed(() => poaps.value.filter((p) => p.type === 'festival'))
  const subEventPoaps = computed(() => poaps.value.filter((p) => p.type === 'sub-event'))
  // Sub-event POAPs from sessions the user did NOT create. Festival POAPs and
  // badges from self-created sessions are auto-minted, so they don't represent
  // "collected" badges for the purposes of nudging the user to attend more.
  const collectibleSubEventPoaps = computed(() => {
    const userAddress = (festivalState.user.address ?? '').toLowerCase()
    if (!userAddress) return subEventPoaps.value
    const ownCreated = new Set(
      festivalState.sessions
        .filter((s) => s.details.creator.toLowerCase() === userAddress)
        .map((s) => s.address.toLowerCase()),
    )
    return subEventPoaps.value.filter((p) => !ownCreated.has(p.sourceContract.toLowerCase()))
  })
  const isLoading = computed(() => festivalState.loading)

  function getById(poapContract: string, tokenId: number): PoapToken | undefined {
    return poaps.value.find((p) => p.poapContract === poapContract && p.tokenId === tokenId)
  }

  function reload(): Promise<void> {
    const wallet = useWalletStore()
    const userH160 = wallet.isConnected ? walletAddressToH160(wallet.address) : null
    return bootLoadAttendee(userH160)
  }

  return { poaps, festivalPoaps, subEventPoaps, collectibleSubEventPoaps, isLoading, getById, reload }
}
