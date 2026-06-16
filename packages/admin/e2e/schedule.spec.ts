import { test, expect } from './setup'
import { waitForAdminReady } from './helpers'

test.describe('Schedule editor', () => {
  test('schedule page renders heading', async ({ testHost }) => {
    const frame = await waitForAdminReady(testHost)

    await frame.locator('[data-testid="nav-item-schedule"]').first().click()
    await expect(frame.locator('[data-testid="schedule-heading"]')).toBeVisible()
    await expect(frame.locator('[data-testid="schedule-add-btn"]')).toBeVisible()
  })

  test('add-entry form exposes the Official / Activations category selector', async ({ testHost }) => {
    const frame = await waitForAdminReady(testHost)

    await frame.locator('[data-testid="nav-item-schedule"]').first().click()
    await frame.locator('[data-testid="schedule-add-btn"]').click()

    const select = frame.locator('[data-testid="schedule-category-select"]')
    await expect(select).toBeVisible()
    await expect(select.locator('option')).toHaveText([
      'Official',
      'Activations',
    ])
  })
})
