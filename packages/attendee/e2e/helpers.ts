import type { TestHost } from '@parity/host-api-test-sdk/playwright'
import type { FrameLocator, Locator } from '@playwright/test'
import { TEST_ACCOUNTS } from '../../shared/host/test-accounts'
import { seedFestivalPreimages } from '../../../scripts/e2e/seed-preimages'

/**
 * Pre-activate the festival pass in the iframe's localStorage so
 * `FestivalPassScreen` never mounts. Clicking Activate in tests can't work: the
 * test SDK has no `handleResourceAllocation` handler, so `claimAllowances()`
 * hangs forever.
 *
 * Set the flag after `waitForConnection` but before bootLoad's reads finish —
 * useFestivalPass reads localStorage once address + isCheckedIn become non-null,
 * which is after the batch read completes.
 */
async function setActivatedFlag(testHost: TestHost): Promise<void> {
  const festivalAddr = (process.env.VITE_FESTIVAL_ADDRESS ?? '').toLowerCase()
  if (!festivalAddr) return
  const key = `festivalPass:${festivalAddr}:${TEST_ACCOUNTS.bob.ss58}`

  // Find the actual iframe Frame object (not FrameLocator) so we can run JS
  // directly in the iframe's origin context. Polling because the iframe may
  // still be navigating to localhost:3200 when waitForConnection returns.
  let iframe = null
  for (let i = 0; i < 50; i++) {
    iframe = testHost.page
      .frames()
      .find((f) => f.url().includes('localhost:3200'))
    if (iframe) break
    await testHost.page.waitForTimeout(100)
  }
  if (!iframe) {
    console.warn('[e2e] setActivatedFlag: iframe never reached localhost:3200')
    return
  }

  const verify = await iframe.evaluate((k) => {
    try {
      window.localStorage.setItem(k, 'activated')
      return { ok: true, readback: window.localStorage.getItem(k), origin: window.location.origin }
    } catch (err) {
      return { ok: false, error: String(err), origin: window.location.origin }
    }
  }, key)

  if (!verify.ok || verify.readback !== 'activated') {
    console.warn('[e2e] setActivatedFlag failed:', verify)
  } else {
    console.log(`[e2e] activation flag set at ${verify.origin} for key ${key}`)
  }
}

/**
 * Wait for the attendee SPA to boot inside the test host. Resolves on
 * the home page render. The passport card is what guarantees the
 * festival metadata round-trip completed.
 */
export async function waitForAttendeeReady(
  testHost: TestHost,
  options?: { timeout?: number },
): Promise<FrameLocator> {
  const timeout = options?.timeout ?? 60_000
  // In the host, metadata resolves only through the preimage manager, and the
  // test host has no Bulletin connection, so seed the blobs before boot.
  await seedFestivalPreimages(testHost)
  await testHost.waitForConnection(timeout)
  const frame = testHost.productFrame()

  // Suppress the activation modal. The setup.ts fixture installs a
  // context.addInitScript that sets the flag before iframe load. This
  // helper-side write is a safety net + diagnostic.
  await setActivatedFlag(testHost)

  await frame
    .locator('[data-testid="home-passport"]')
    .waitFor({ state: 'visible', timeout })

  // Verify storage value at the moment the home page renders. Helps
  // disambiguate "init script didn't run" vs "SPA didn't honor flag".
  const festivalAddr = (process.env.VITE_FESTIVAL_ADDRESS ?? '').toLowerCase()
  if (festivalAddr) {
    const iframe = testHost.page
      .frames()
      .find((f) => f.url().includes('localhost:3200'))
    if (iframe) {
      const value = await iframe.evaluate(
        (k) => window.localStorage.getItem(k),
        `festivalPass:${festivalAddr}:${TEST_ACCOUNTS.bob.ss58}`,
      )
      console.log(`[e2e] post-boot localStorage festivalPass value: ${value}`)
    }
  }

  // Belt-and-braces: if the modal still mounted (SPA didn't honor the flag
  // we set), dismiss it by writing the flag again + reloading-equivalent
  // trigger via a custom event the SPA can listen on. Or just navigate
  // around it. But we'll see from the log above whether it's needed.
  const passModal = frame.locator('[data-testid="festival-pass-screen"]')
  if (await passModal.isVisible({ timeout: 1_000 }).catch(() => false)) {
    console.log('[e2e] festival-pass modal mounted despite activation flag — attempting reload')
    await testHost.page.reload()
    await testHost.waitForConnection(timeout)
    await frame
      .locator('[data-testid="home-passport"]')
      .waitFor({ state: 'visible', timeout })
  }

  return frame
}

/**
 * Resolve the active nav surface (desktop sidebar or mobile tab bar) so
 * tests stay viewport-agnostic. Both surfaces render the same nav items.
 */
export async function navLink(
  frame: FrameLocator,
  label: 'home' | 'map' | 'program',
): Promise<Locator> {
  const sidebar = frame.locator(`[data-testid="nav-item-${label}"]`)
  if (await sidebar.isVisible().catch(() => false)) return sidebar
  return frame.locator(`[data-testid="tab-${label}"]`)
}

/**
 * Resolve a locator for the first venue marker that is genuinely clickable
 * *right now*.
 *
 * Two map behaviours make a naive `.vmarker.first()` flaky:
 *   1. Progressive zoom-reveal renders several categories (service, emergency,
 *      base/activations at the lowest tier) `opacity:0; pointer-events:none`
 *      until you zoom in. And Playwright's visibility check ignores `opacity`,
 *      so it can resolve to a transparent, non-clickable marker.
 *   2. Selecting a marker pans/zooms the map (`focusMarker`), so a previously
 *      visible marker can end up off-viewport or under a zone polygon. The
 *      MapLibre canvas then intercepts the click.
 *
 * We therefore pick the first marker that is interactive (pointer-events:auto,
 * non-transparent) AND whose centre actually hit-tests to itself (in-viewport,
 * not occluded), then address it by its stable `data-marker-id`. Re-resolve
 * after any action that moves the camera rather than reusing a stale locator.
 */
export async function firstInteractiveMarker(
  frame: FrameLocator,
): Promise<Locator> {
  // Wait for the marker set to reach its final state. The festival metadata
  // (which carries the real venue markers) is fetched un-awaited during boot,
  // so markers briefly fall back to mock data and then swap once it lands.
  // Selecting during that window drops the selection when the array swaps.
  await frame
    .locator('[data-testid="map-page"][data-markers-ready="true"]')
    .waitFor()
  await frame.locator('.vmarker').first().waitFor()
  const id = await frame.locator('[data-testid="venue-map"]').evaluate((mapEl) => {
    const doc = mapEl.ownerDocument
    for (const el of doc.querySelectorAll<HTMLElement>('.vmarker')) {
      const cs = getComputedStyle(el)
      if (cs.pointerEvents !== 'auto' || cs.opacity === '0') continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const cx = r.x + r.width / 2
      const cy = r.y + r.height / 2
      const top = doc.elementFromPoint(cx, cy)
      if (top && (top === el || el.contains(top))) {
        return el.getAttribute('data-marker-id')
      }
    }
    return null
  })
  if (!id) {
    throw new Error('firstInteractiveMarker: no clickable .vmarker in view')
  }
  return frame.locator(`.vmarker[data-marker-id="${id}"]`)
}
