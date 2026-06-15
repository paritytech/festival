import { ref, reactive, computed, watch, provide, inject, toRaw, type Ref, type InjectionKey } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import type { FestivalRole } from './usePermissions'
import type { FestivalMetadata } from '@festival/shared/metadata/schemas'
import type { TxStatus } from '@festival/shared/contracts/write'
import { readFestivalDetails } from '@festival/shared/contracts/festival-reads'
import { festivalState } from '@festival/shared/cache/festival-state'

/** Deep-copy that works on Vue reactive proxies (structuredClone can't handle them). */
function deepCopy<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

export interface FestivalContext {
  address: string
  userRoles: Ref<FestivalRole[]>
  rolesReady: Ref<boolean>
  savedMetadata: Ref<FestivalMetadata | null>
  draft: FestivalMetadata
  isDirty: Ref<boolean>
  changedSections: Ref<string[]>
  totalChangeCount: Ref<number>
  publish: () => Promise<void>
  discardChanges: () => void
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

  async function publish() {
    txError.value = null
    txStatus.value = 'preparing'
    try {
      const { useMetadataSave } = await import('./useMetadataSave')
      const saver = useMetadataSave(address)
      await saver.save(toRaw(draft) as FestivalMetadata)
      txStatus.value = saver.txStatus.value
      if (saver.error.value) throw new Error(saver.error.value)
      savedMetadata.value = deepCopy(draft)

      // Refresh festivalState with the freshly-published details so the UI
      // reflects the new metadata immediately.
      try {
        const freshDetails = await readFestivalDetails(address as `0x${string}`)
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

  function discardChanges() {
    if (!savedMetadata.value) return
    const fresh = deepCopy(savedMetadata.value)
    draft.name = fresh.name
    draft.description = fresh.description
    draft.organizer = fresh.organizer
    draft.website = fresh.website
    draft.image = fresh.image
    draft.tags.splice(0, draft.tags.length, ...fresh.tags)
    Object.assign(draft.location, fresh.location)
    draft.schedule.splice(0, draft.schedule.length, ...fresh.schedule)
    if (fresh.venueMap && draft.venueMap) {
      draft.venueMap.markers.splice(0, draft.venueMap.markers.length, ...fresh.venueMap.markers)
    } else if (fresh.venueMap) {
      (draft as any).venueMap = fresh.venueMap
    }
    if (fresh.social) {
      draft.social = { ...fresh.social }
    }
    draft.festivalPoapImage = fresh.festivalPoapImage
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

  // Seed savedMetadata + draft from festivalState once bootLoadAdmin lands
  // and metadata resolves. Roles flow through `userRoles` directly via the
  // computed above. No manual refresh needed.
  let stop: (() => void) | null = null
  stop = watch(
    () => festivalState.festival?.metadata,
    (meta) => {
      if (!meta) return
      stop?.()
      savedMetadata.value = deepCopy(meta)
      Object.assign(draft, deepCopy(meta))
    },
    { immediate: true },
  )

  const context: FestivalContext = {
    address, userRoles, rolesReady, savedMetadata, draft, isDirty, changedSections, totalChangeCount,
    publish, discardChanges, txStatus, txError,
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
