import { test, expect } from './setup'
import { waitForAdminReady } from './helpers'

test.describe('Sessions list', () => {
  test('sessions page renders heading and create link', async ({ testHost }) => {
    const frame = await waitForAdminReady(testHost)

    await frame.locator('[data-testid="nav-item-sub-events"]').first().click()
    await expect(frame.locator('[data-testid="sub-events-heading"]')).toBeVisible()
    await expect(frame.locator('[data-testid="sub-event-create-link"]')).toBeVisible()
  })

  test('flagged sessions render a flag badge in the list', async ({ testHost }) => {
    const frame = await waitForAdminReady(testHost)

    await frame.locator('[data-testid="nav-item-sub-events"]').first().click()
    await expect(frame.locator('[data-testid="sub-events-heading"]')).toBeVisible()

    const badges = frame.locator('[data-testid="session-flag-badge"]')
    await expect(badges.first()).toBeVisible()
    // Each badge text is "⚑ N / M". Sanity-check shape.
    const text = (await badges.first().textContent()) ?? ''
    expect(text).toMatch(/\d+\s*\/\s*\d+/)
  })

  test('moderation banner appears on a flagged session detail', async ({ testHost }) => {
    const frame = await waitForAdminReady(testHost)

    await frame.locator('[data-testid="nav-item-sub-events"]').first().click()
    const flaggedRow = frame.locator('a:has([data-testid="session-flag-badge"])').first()
    await expect(flaggedRow).toBeVisible()

    await flaggedRow.click()
    await expect(frame.locator('[data-testid="moderation-banner"]')).toBeVisible()
  })
})
