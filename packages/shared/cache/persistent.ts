import { ref, watch, type Ref } from 'vue'
import { getStorage } from './storage'

/**
 * A ref backed by BOTH layers:
 *  - `window.localStorage` — synchronous, read at creation for instant paint
 *    (unchanged cold-start UX).
 *  - the host storage bridge (`getStorage()`) — async, durable across mobile
 *    WebView eviction / process death, which plain localStorage is not.
 *
 * On creation it inits synchronously from localStorage, then asynchronously
 * adopts the host value if present (host is authoritative); if the host slot is
 * empty but localStorage has a value, it migrates that value up once. Every
 * change writes through to both. Mirrors the localStorage-fast + durable-fallback
 * pattern useFestivalPass already uses for the activation flag.
 */
export function usePersistentRef<T>(key: string, initial: T): Ref<T> {
  const local = readLocalSync<T>(key)
  const state = ref<T>(local ?? initial) as Ref<T>

  // A mutation that lands before the async host read resolves must win over
  // the (older) host value — write-through is already syncing it up.
  let dirty = false

  void (async () => {
    try {
      const hostVal = await getStorage().readJSON<T>(key)
      if (dirty) return
      if (hostVal != null) {
        state.value = hostVal
      } else if (local != null) {
        await getStorage().writeJSON(key, local)
      }
    } catch {
      // Host bridge unavailable (standalone, or pre-host boot). localStorage covers us.
    }
  })()

  watch(
    state,
    (v) => {
      dirty = true
      writeLocalSync(key, v)
      void getStorage().writeJSON(key, v)
    },
    { deep: true },
  )

  return state
}

function readLocalSync<T>(key: string): T | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeLocalSync(key: string, value: unknown): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Quota / private mode. Host storage still gets the durable copy.
  }
}
