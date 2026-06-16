/**
 * Pure decision helpers for the festival editing context.
 *
 * These hold the logic that is easy to get wrong (draft re-sync vs unsaved
 * edits, publish conflict detection) in side-effect-free functions so they can
 * be unit-tested without a Nuxt/`provide`-`inject` harness. The composable in
 * `useFestivalContext.ts` calls these and applies the resulting decision.
 */

/** What to do with the editable draft when fresh on-chain metadata is observed. */
export type SyncAction =
  /** Draft has no unsaved edits → adopt the fresh metadata into the draft. */
  | 'adopt'
  /** Draft is dirty AND the on-chain CID moved → keep the draft, flag the divergence. */
  | 'flag'
  /** Draft is dirty but the CID did not move (e.g. boot ordering) → leave as-is. */
  | 'keep'

export interface SyncDecision {
  action: SyncAction
  remoteChanged: boolean
}

/**
 * Decide how a freshly-observed on-chain metadata should affect the draft.
 *
 * Dirtiness is passed in as pre-serialized JSON (computed synchronously by the
 * caller) so this stays pure and never relies on the debounced `isDirty` ref,
 * which can lag a just-made edit by up to 300ms.
 */
export function computeSyncDecision(args: {
  /** JSON.stringify of the current draft (raw). */
  draftJson: string
  /** JSON.stringify of the current saved/published baseline. */
  savedJson: string
  /** The on-chain metadataCid of the incoming metadata. */
  incomingCid: string
  /** The CID the draft is currently based on (null before first seed). */
  baseCid: string | null
}): SyncDecision {
  const draftDirty = args.draftJson !== args.savedJson
  const cidChanged = args.incomingCid !== args.baseCid

  if (!draftDirty) return { action: 'adopt', remoteChanged: false }
  if (cidChanged) return { action: 'flag', remoteChanged: true }
  return { action: 'keep', remoteChanged: false }
}

/**
 * True when the draft's base CID no longer matches the latest on-chain CID,
 * i.e. another writer published since this draft was loaded. A null base means
 * nothing has been published yet (first publish), so there is no conflict.
 */
export function isPublishConflict(baseCid: string | null, onChainCid: string): boolean {
  return baseCid !== null && onChainCid !== baseCid
}
