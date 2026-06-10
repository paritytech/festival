import { test, expect } from './setup'
import { waitForAdminReady } from './helpers'

test.describe('Admin boot', () => {
  test('festival layout loads inside the host', async ({ testHost }) => {
    const frame = await waitForAdminReady(testHost)
    await expect(frame.locator('[data-testid="admin-layout-ready"]')).toBeVisible()
  })

  test('shows nav items for role-bearing accounts', async ({ testHost }) => {
    const frame = await waitForAdminReady(testHost)
    await expect(frame.locator('[data-testid="nav-item-overview"]').first()).toBeVisible()
  })

  test('switching to a different dev account preserves role visibility', async ({ testHost }) => {
    await waitForAdminReady(testHost)

    // host-api-test-sdk ≥ 0.7 disposes + recreates the container on
    // switchAccount, which means the iframe reloads. Re-fetch the frame
    // locator after the switch. The prior reference points at an iframe
    // that no longer exists.
    await testHost.switchAccount('bob')
    await testHost.waitForConnection()
    const frame = testHost.productFrame()

    // The recreated container starts with an empty preimage store, but this
    // test only checks nav visibility, which comes from chain roles not
    // metadata, so seeding again isn't needed.

    // Both Alice and Bob are granted the full role set by the seed step,
    // so the role-bearing layout is what we expect after either switch.
    await expect(
      frame.locator('[data-testid="nav-item-overview"]').first(),
    ).toBeVisible({ timeout: 60_000 })
  })
})
