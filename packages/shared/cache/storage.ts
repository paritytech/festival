import { getHostLocalStorage } from '@parity/product-sdk-host'
import { isInHost } from '../host/detect'

export interface CacheStorage {
  readJSON<T>(key: string): Promise<T | null>
  writeJSON(key: string, value: unknown): Promise<void>
  clear(key: string): Promise<void>
}

function createHostStorage(): CacheStorage {
  // Lazy-resolve the host storage handle; null outside a host container.
  let storage: Awaited<ReturnType<typeof getHostLocalStorage>> = null
  async function getHostStorage() {
    if (!storage) {
      storage = await getHostLocalStorage()
    }
    return storage
  }

  return {
    async readJSON<T>(key: string): Promise<T | null> {
      try {
        const s = await getHostStorage()
        if (!s) return null
        const result = await s.readJSON(key)
        return (result ?? null) as T | null
      } catch {
        return null
      }
    },
    async writeJSON(key: string, value: unknown): Promise<void> {
      try {
        const s = await getHostStorage()
        if (!s) return
        await s.writeJSON(key, value)
      } catch (e) {
        console.warn('[CacheStorage] Host write failed:', e)
      }
    },
    async clear(key: string): Promise<void> {
      try {
        const s = await getHostStorage()
        if (!s) return
        await s.clear(key)
      } catch (e) {
        console.warn('[CacheStorage] Host clear failed:', e)
      }
    },
  }
}

function createLocalStorage(): CacheStorage {
  return {
    async readJSON<T>(key: string): Promise<T | null> {
      try {
        const raw = localStorage.getItem(key)
        if (!raw) return null
        return JSON.parse(raw) as T
      } catch {
        return null
      }
    },
    async writeJSON(key: string, value: unknown): Promise<void> {
      try {
        localStorage.setItem(key, JSON.stringify(value))
      } catch (e) {
        console.warn('[CacheStorage] localStorage write failed:', e)
      }
    },
    async clear(key: string): Promise<void> {
      localStorage.removeItem(key)
    },
  }
}

let instance: CacheStorage | null = null

export function getStorage(): CacheStorage {
  if (!instance) {
    instance = isInHost() ? createHostStorage() : createLocalStorage()
  }
  return instance
}
