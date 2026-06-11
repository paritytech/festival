import { test, expect } from './setup'
import { waitForAdminReady } from './helpers'

test.describe('Festival overview', () => {
  test('shows festival name, status badge, and stats grid', async ({ testHost }) => {
    const frame = await waitForAdminReady(testHost)

    // The overview body only renders once festival metadata arrives, fetched
    // after boot via the preimage manager (seeded in waitForAdminReady). Give it
    // headroom; the rest of the asserts share the same metadata block, so they
    // resolve as soon as the first one does.
    await expect(frame.locator('[data-testid="festival-name"]')).toBeVisible({ timeout: 90_000 })
    await expect(frame.locator('[data-testid="festival-status-badge"]')).toBeVisible()
    await expect(frame.locator('[data-testid="stat-registered"]')).toBeVisible()
    await expect(frame.locator('[data-testid="stat-checked-in"]')).toBeVisible()
    await expect(frame.locator('[data-testid="stat-capacity"]')).toBeVisible()
    await expect(frame.locator('[data-testid="stat-sessions"]')).toBeVisible()
  })
})
