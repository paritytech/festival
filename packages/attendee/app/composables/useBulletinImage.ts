import { ref, watch, onScopeDispose, toValue, type MaybeRefOrGetter } from 'vue'
import { getCachedMetadata } from '@festival/shared/cache/cid-cache'

/**
 * Resolve a Bulletin image CID to a reactive URL for `<img :src>`.
 *
 * In the host the bytes come from the preimage manager as a `blob:` URL;
 * standalone falls back to the gateway. Reuses the `img:<cid>` cache that
 * usePoaps warms, and revokes any `blob:` URL it made when the cid changes or
 * the scope unmounts.
 *
 * @param cidSource reactive CID; falsy means no image.
 * @returns ref holding the URL, or null until it resolves.
 */
export function useBulletinImage(cidSource: MaybeRefOrGetter<string | null | undefined>) {
  const url = ref<string | null>(null)
  let currentBlobUrl: string | null = null
  let disposed = false

  function revoke() {
    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl)
      currentBlobUrl = null
    }
  }

  watch(
    () => toValue(cidSource),
    async (cid) => {
      revoke()
      url.value = null
      if (!cid) return

      // Check the warm cache first. No network, works offline.
      const cached = await getCachedMetadata<string>(`img:${cid}`)
      if (cached) {
        if (!disposed && toValue(cidSource) === cid) url.value = cached
        return
      }

      // Lazy import keeps the bulletin SDK out of the initial chunk.
      const { useBulletinStorage } = await import('@festival/shared/metadata/bulletin')
      const resolved = await useBulletinStorage().resolveDisplayImageUrl(cid)

      // If the cid moved on or the scope is gone, drop this result and free the
      // blob so we don't leak it or show the wrong image.
      if (disposed || toValue(cidSource) !== cid) {
        if (resolved?.startsWith('blob:')) URL.revokeObjectURL(resolved)
        return
      }

      if (resolved?.startsWith('blob:')) currentBlobUrl = resolved
      url.value = resolved
    },
    { immediate: true },
  )

  onScopeDispose(() => {
    disposed = true
    revoke()
  })

  return url
}
