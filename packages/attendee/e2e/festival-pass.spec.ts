import { test, expect } from './setup'
import { TEST_ACCOUNTS } from '../../shared/host/test-accounts'
import type { TestHost } from '@parity/host-api-test-sdk/playwright'
import type { Page } from '@playwright/test'

// Scope note. Two things keep most of the pass flow out of e2e and into manual
// verification:
//   - The test host SDK has no resource-allocation handler, so tapping
//     "Activate" (claimAllowances) hangs — the claim success/failure modals and
//     the gated "Activation needed" → claim flow are unreachable.
//   - The activation overlay only mounts in-host, checked-in, with a PGAS=0
//     read, which isn't reliably reproducible here.
// What we can guard reliably is the regression that motivated this work: a
// deferred user is never locked out.

const FESTIVAL_ADDRESS = (process.env.VITE_FESTIVAL_ADDRESS ?? '').toLowerCase()
const PASS_KEY = `festivalPass:${FESTIVAL_ADDRESS}:${TEST_ACCOUNTS.bob.ss58}`

// Boot with the 'deferred' pass flag instead of the fixture's 'activated'. The
// context init script applies on every load, so a reload after registering it
// guarantees the SPA reads our value on a clean boot.
async function bootDeferred(testHost: TestHost, page: Page) {
  await page.context().addInitScript((k) => {
    try {
      window.localStorage.setItem(k, 'deferred')
    } catch {
      /* private mode / quota */
    }
  }, PASS_KEY)

  await testHost.waitForConnection(60_000)
  await testHost.page.reload()
  await testHost.waitForConnection(60_000)
  return testHost.productFrame()
}

test.describe('Festival pass', () => {
  test('deferred user is not locked out', async ({ page, testHost }) => {
    const frame = await bootDeferred(testHost, page)

    // Home renders and neither the soft-block overlay nor any activation modal
    // is mounted — the deferred user can use the app.
    await frame
      .locator('[data-testid="home-passport"]')
      .waitFor({ state: 'visible', timeout: 60_000 })
    await expect(
      frame.locator('[data-testid="festival-pass-screen"]'),
    ).toHaveCount(0)
    await expect(
      frame.locator('[data-testid="activation-modal"]'),
    ).toHaveCount(0)
  })
})
