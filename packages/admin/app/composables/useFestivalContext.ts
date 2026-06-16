import { ref, reactive, computed, watch, provide, inject, toRaw, type Ref, type InjectionKey } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import type { FestivalRole } from './usePermissions'
import type { FestivalMetadata } from '@festival/shared/metadata/schemas'
import type { TxStatus } from '@festival/shared/contracts/write'
import { readFestivalDetails } from '@festival/shared/contracts/festival-reads'
import { festivalState } from '@festival/shared/cache/festival-state'
import { computeSyncDecision, isPublishConflict } from './useFestivalContext.helpers'

/** Deep-copy that works on Vue reactive proxies (structuredClone can't handle them). */
function deepCopy<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

/** `txError` sentinel set when publish() aborts on a concurrent-change conflict. */
export const PUBLISH_CONFLICT = 'CONFLICT'

export interface FestivalContext {
  address: string
  userRoles: Ref<FestivalRole[]>
  rolesReady: Ref<boolean>
  savedMetadata: Ref<FestivalMetadata | null>
  draft: FestivalMetadata
  isDirty: Ref<boolean>
  changedSections: Ref<string[]>
  totalChangeCount: Ref<number>
  /** The on-chain metadataCid the draft/savedMetadata is currently based on. */
  baseMetadataCid: Ref<string | null>
  /** True when an external publish landed while the draft had unsaved edits. */
  remoteChanged: Ref<boolean>
  publish: (opts?: { force?: boolean }) => Promise<void>
  discardChanges: () => void
  /** Dismiss the remote-change flag without refreshing (keep editing). */
  acknowledgeRemoteChange: () => void
  txStatus: Ref<TxStatus>
  txError: Ref<string | null>
  scheduleEntryStatus: (id: string) => 'new' | 'modified' | 'unchanged'
  deletedScheduleEntries: () => { id: string; title: string }[]
  markerStatus: (id: string) => 'new' | 'modified' | 'unchanged'
  deletedMarkers: () => { id: string; label: string }[]
  undoScheduleEntry: (id: string) => void
  undoMarker: (id: string) => void
  restoreDeletedScheduleEntry: (id: string) => void
  restoreDeletedMarker: (id: string) => void
}

const FESTIVAL_CONTEXT_KEY: InjectionKey<FestivalContext> = Symbol('festival-context')

export function provideFestivalContext(address: string) {
  // Roles flow from `festivalState.user.roles` (populated by bootLoadAdmin).
  const userRoles = computed<FestivalRole[]>(() => festivalState.user.roles)
  const rolesReady = computed(() => festivalState.loaded)

  const savedMetadata = ref<FestivalMetadata | null>(null)
  const draft = reactive<FestivalMetadata>({
    version: '1.0', type: 'festival', name: '', description: '',
    location: { venue: '', address: '' }, image: '', organizer: '', tags: [], schedule: [],
  } as FestivalMetadata)

  const isDirty = ref(false)
  const changedSections = ref<string[]>([])
  const totalChangeCount = ref(0)
  const baseMetadataCid = ref<string | null>(null)
  const remoteChanged = ref(false)

  /** Empty baseline for comparison when no metadata has been published yet. */
  const emptyBaseline: FestivalMetadata = {
    version: '1.0', type: 'festival', name: '', description: '',
    location: { venue: '', address: '' }, image: '', organizer: '', tags: [], schedule: [],
  } as FestivalMetadata

  function recalculateDirtyState() {
    const baseline = savedMetadata.value ?? emptyBaseline
    const savedStr = JSON.stringify(baseline)
    const draftStr = JSON.stringify(draft)
    isDirty.value = savedStr !== draftStr

    if (!isDirty.value) {
      changedSections.value = []
      totalChangeCount.value = 0
      return
    }

    // Changed sections
    const saved = baseline
    const sections: string[] = []
    const overviewChanged =
      draft.name !== saved.name || draft.description !== saved.description ||
      draft.organizer !== saved.organizer || draft.website !== saved.website ||
      JSON.stringify(draft.location) !== JSON.stringify(saved.location) ||
      JSON.stringify(draft.tags) !== JSON.stringify(saved.tags) ||
      draft.festivalPoapImage !== saved.festivalPoapImage
    if (overviewChanged) sections.push('Overview')
    if (JSON.stringify(draft.schedule) !== JSON.stringify(saved.schedule)) sections.push('Schedule')
    if (JSON.stringify(draft.venueMap?.markers) !== JSON.stringify(saved.venueMap?.markers)) sections.push('Map markers')
    changedSections.value = sections

    // Total change count
    let count = 0
    const savedIds = new Set(saved.schedule.map(e => e.id))
    const draftIds = new Set(draft.schedule.map(e => e.id))
    for (const e of draft.schedule) {
      if (!savedIds.has(e.id)) count++
      else if (JSON.stringify(e) !== JSON.stringify(saved.schedule.find(s => s.id === e.id))) count++
    }
    count += saved.schedule.filter(e => !draftIds.has(e.id)).length

    const savedMarkerIds = new Set((saved.venueMap?.markers || []).map(m => m.id))
    const draftMarkerIds = new Set((draft.venueMap?.markers || []).map(m => m.id))
    for (const m of (draft.venueMap?.markers || [])) {
      if (!savedMarkerIds.has(m.id)) count++
      else if (JSON.stringify(m) !== JSON.stringify(saved.venueMap?.markers.find(s => s.id === m.id))) count++
    }
    count += (saved.venueMap?.markers || []).filter(m => !draftMarkerIds.has(m.id)).length

    if (overviewChanged) count++
    totalChangeCount.value = count
  }

  const debouncedRecalc = useDebounceFn(recalculateDirtyState, 300)
  watch(() => draft, () => debouncedRecalc(), { deep: true })
  watch(savedMetadata, () => recalculateDirtyState())

  const txStatus = ref<TxStatus>('idle')
  const txError = ref<string | null>(null)

  async function publish(opts: { force?: boolean } = {}) {
    txError.value = null
    txStatus.value = 'preparing'
    try {
      // Concurrency guard: re-read the current on-chain cid and compare it to
      // the cid this draft is based on. A mismatch means another writer
      // (another admin tab, a maintenance script) published since we loaded, so
      // writing the whole draft blob now would silently overwrite their change.
      // Abort, pull their data in so the user can re-apply against it, and flag
      // the conflict. Read at 'best' (≈6s, same as the post-publish refresh
      // below): a recent concurrent publish is already in the best block, so
      // 'best' detects it; 'finalized' could miss an in-block-but-unfinalized one.
      if (!opts.force && baseMetadataCid.value !== null) {
        const onChain = await readFestivalDetails(address as `0x${string}`)
        if (isPublishConflict(baseMetadataCid.value, onChain.metadataCid)) {
          try {
            const { useBulletinStorage } = await import('@festival/shared/metadata/bulletin')
            const latest = await useBulletinStorage().retrievePlaintext<FestivalMetadata>(onChain.metadataCid)
            savedMetadata.value = deepCopy(latest)
            baseMetadataCid.value = onChain.metadataCid
            if (festivalState.festival) {
              festivalState.festival.details = onChain
              festivalState.festival.metadata = deepCopy(latest)
            }
          } catch {
            // Couldn't fetch the latest blob; still block. useFestivalWatcher
            // will sync savedMetadata/draft once it resolves the new cid.
          }
          remoteChanged.value = true
          txStatus.value = 'error'
          txError.value = PUBLISH_CONFLICT
          return
        }
      }

      const { useMetadataSave } = await import('./useMetadataSave')
      const saver = useMetadataSave(address)
      await saver.save(toRaw(draft) as FestivalMetadata)
      txStatus.value = saver.txStatus.value
      if (saver.error.value) throw new Error(saver.error.value)
      savedMetadata.value = deepCopy(draft)

      // Refresh festivalState with the freshly-published details so the UI
      // reflects the new metadata immediately, and advance the base cid so the
      // sync watcher treats our own write as already-applied (no false conflict).
      try {
        const freshDetails = await readFestivalDetails(address as `0x${string}`)
        baseMetadataCid.value = freshDetails.metadataCid
        if (festivalState.festival) {
          festivalState.festival.details = freshDetails
          festivalState.festival.metadata = deepCopy(draft) as FestivalMetadata
        }
      } catch {
        // Non-critical. Next reload picks it up.
      }

      setTimeout(() => { txStatus.value = 'idle' }, 3000)
    } catch (e: any) {
      txStatus.value = 'error'
      txError.value = e.message
    }
  }

  /**
   * Reset the editable `draft` in place to match `fresh`, preserving reactive
   * array/object identities (splice arrays, replace nested object contents) so
   * Vue's keyed lists and v-model bindings keep working. Used by both
   * discardChanges() and the live on-chain sync below.
   */
  function seedDraftInPlace(fresh: FestivalMetadata) {
    draft.name = fresh.name
    draft.description = fresh.description
    draft.organizer = fresh.organizer
    draft.website = fresh.website
    draft.image = fresh.image
    draft.tags.splice(0, draft.tags.length, ...(fresh.tags ?? []))
    Object.assign(draft.location, fresh.location)
    draft.schedule.splice(0, draft.schedule.length, ...(fresh.schedule ?? []))
    if (fresh.venueMap) {
      if (draft.venueMap) {
        // Keep the markers array reference; replace its contents and the other
        // venueMap fields (image/floors) so a full version swap fully syncs.
        draft.venueMap.markers.splice(0, draft.venueMap.markers.length, ...(fresh.venueMap.markers ?? []))
        Object.assign(draft.venueMap, { ...deepCopy(fresh.venueMap), markers: draft.venueMap.markers })
      } else {
        (draft as any).venueMap = deepCopy(fresh.venueMap)
      }
    } else {
      delete (draft as any).venueMap
    }
    draft.social = fresh.social ? { ...fresh.social } : undefined
    draft.festivalPoapImage = fresh.festivalPoapImage
  }

  function discardChanges() {
    if (!savedMetadata.value) return
    seedDraftInPlace(deepCopy(savedMetadata.value))
    remoteChanged.value = false
  }

  function acknowledgeRemoteChange() {
    remoteChanged.value = false
  }

  function scheduleEntryStatus(id: string): 'new' | 'modified' | 'unchanged' {
    if (!savedMetadata.value) return 'new'
    const saved = savedMetadata.value.schedule.find(e => e.id === id)
    if (!saved) return 'new'
    const current = draft.schedule.find(e => e.id === id)
    if (!current) return 'unchanged'
    return JSON.stringify(saved) === JSON.stringify(current) ? 'unchanged' : 'modified'
  }

  function deletedScheduleEntries(): { id: string; title: string }[] {
    if (!savedMetadata.value) return []
    const draftIds = new Set(draft.schedule.map(e => e.id))
    return savedMetadata.value.schedule
      .filter(e => !draftIds.has(e.id))
      .map(e => ({ id: e.id, title: e.title || e.id }))
  }

  function markerStatus(id: string): 'new' | 'modified' | 'unchanged' {
    if (!savedMetadata.value?.venueMap) return 'new'
    const saved = savedMetadata.value.venueMap.markers.find(m => m.id === id)
    if (!saved) return 'new'
    const current = draft.venueMap?.markers.find(m => m.id === id)
    if (!current) return 'unchanged'
    return JSON.stringify(saved) === JSON.stringify(current) ? 'unchanged' : 'modified'
  }

  function deletedMarkers(): { id: string; label: string }[] {
    if (!savedMetadata.value?.venueMap) return []
    const draftIds = new Set((draft.venueMap?.markers || []).map(m => m.id))
    return savedMetadata.value.venueMap.markers
      .filter(m => !draftIds.has(m.id))
      .map(m => ({ id: m.id, label: m.label || m.id }))
  }

  function undoScheduleEntry(id: string) {
    const status = scheduleEntryStatus(id)
    if (status === 'new') {
      const idx = draft.schedule.findIndex(e => e.id === id)
      if (idx >= 0) draft.schedule.splice(idx, 1)
    } else if (status === 'modified' && savedMetadata.value) {
      const saved = savedMetadata.value.schedule.find(e => e.id === id)
      const idx = draft.schedule.findIndex(e => e.id === id)
      if (saved && idx >= 0) draft.schedule[idx] = deepCopy(saved)
    }
  }

  function undoMarker(id: string) {
    const status = markerStatus(id)
    if (status === 'new') {
      const idx = draft.venueMap?.markers.findIndex(m => m.id === id) ?? -1
      if (idx >= 0) draft.venueMap!.markers.splice(idx, 1)
    } else if (status === 'modified' && savedMetadata.value?.venueMap) {
      const saved = savedMetadata.value.venueMap.markers.find(m => m.id === id)
      const idx = draft.venueMap?.markers.findIndex(m => m.id === id) ?? -1
      if (saved && idx >= 0) draft.venueMap!.markers[idx] = deepCopy(saved)
    }
  }

  function restoreDeletedScheduleEntry(id: string) {
    if (!savedMetadata.value) return
    const saved = savedMetadata.value.schedule.find(e => e.id === id)
    if (saved) draft.schedule.push(deepCopy(saved))
  }

  function restoreDeletedMarker(id: string) {
    if (!savedMetadata.value?.venueMap || !draft.venueMap) return
    const saved = savedMetadata.value.venueMap.markers.find(m => m.id === id)
    if (saved) draft.venueMap.markers.push(deepCopy(saved))
  }

  /**
   * Keep `savedMetadata` + `draft` in sync with the latest on-chain metadata.
   *
   * `festivalState.festival.metadata` is refreshed both by bootLoadAdmin's
   * initial fetch AND by useFestivalWatcher on `MetadataUpdated` events, so a
   * persistent watcher picks up cold-boot freshness and live external publishes
   * alike. `savedMetadata` (the diff baseline) always tracks the freshest
   * published state; the draft is only re-seeded when it has no unsaved edits —
   * otherwise the user's edits are preserved and `remoteChanged` is flagged.
   */
  function syncFromChain() {
    const fest = festivalState.festival
    const meta = fest?.metadata
    if (!meta) return
    const incomingCid = fest.details.metadataCid

    const baseline = savedMetadata.value ?? emptyBaseline
    const decision = computeSyncDecision({
      // Synchronous dirty check — never trust the debounced isDirty ref here.
      draftJson: JSON.stringify(toRaw(draft)),
      savedJson: JSON.stringify(baseline),
      incomingCid,
      baseCid: baseMetadataCid.value,
    })

    savedMetadata.value = deepCopy(meta)
    baseMetadataCid.value = incomingCid

    if (decision.action === 'adopt') {
      seedDraftInPlace(deepCopy(meta))
      remoteChanged.value = false
    } else if (decision.action === 'flag') {
      remoteChanged.value = true
    }
    // 'keep' → leave the draft and remoteChanged untouched.
  }

  // `flush: 'sync'` so a remote event can't slip past a just-typed edit inside
  // the 300ms dirty-recalc debounce window. Watching both metadata and the cid
  // covers the boot path (metadata set without a cid change) and the event path
  // (applyMetadataUpdated sets both atomically).
  watch(
    () => [festivalState.festival?.metadata, festivalState.festival?.details.metadataCid] as const,
    () => syncFromChain(),
    { immediate: true, flush: 'sync' },
  )

  const context: FestivalContext = {
    address, userRoles, rolesReady, savedMetadata, draft, isDirty, changedSections, totalChangeCount,
    baseMetadataCid, remoteChanged,
    publish, discardChanges, acknowledgeRemoteChange, txStatus, txError,
    scheduleEntryStatus, deletedScheduleEntries, markerStatus, deletedMarkers,
    undoScheduleEntry, undoMarker, restoreDeletedScheduleEntry, restoreDeletedMarker,
  }
  provide(FESTIVAL_CONTEXT_KEY, context)
  return context
}

export function useFestivalContext(): FestivalContext {
  const context = inject(FESTIVAL_CONTEXT_KEY)
  if (!context) throw new Error('useFestivalContext must be used inside a festival layout')
  return context
}
