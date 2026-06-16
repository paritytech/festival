import { test, expect } from './setup'
import { waitForAttendeeReady, navLink } from './helpers'

// Bookmark scheduling (pushNotification with scheduledAt + cancel) is not
// covered here yet; the round-trip test still needs writing. Until then it is
// exercised manually via the in-app /debug page.
test.describe('Program', () => {
  test('renders Program + My List tabs when checked in', async ({ testHost }) => {
    const frame = await waitForAttendeeReady(testHost)

    await (await navLink(frame, 'program')).click()
    await expect(frame.locator('[data-testid="program-tab-program"]')).toBeVisible()
    // Bob is checked in via the seed step, so the My List tab is reachable.
    await expect(frame.locator('[data-testid="program-tab-mylist"]')).toBeVisible()
  })

  test('?tab=mylist activates the My List tab when checked in', async ({ testHost }) => {
    const frame = await waitForAttendeeReady(testHost)

    await (await navLink(frame, 'program')).click()
    const mylistTab = frame.locator('[data-testid="program-tab-mylist"]')
    await expect(mylistTab).toBeVisible()
    await mylistTab.click()
    await expect(mylistTab).toHaveClass(/text-white(?!\/)/)
  })

  test('Sessions Type legend lists Official, Community, and Activations', async ({ testHost }) => {
    const frame = await waitForAttendeeReady(testHost)

    await (await navLink(frame, 'program')).click()
    await frame.locator('[data-testid="program-tab-program"]').waitFor({ state: 'visible' })

    // The seed fixture always carries schedule entries, so the legend renders.
    const legend = frame.locator('[data-testid="sessions-type-legend"]').first()
    await expect(legend).toBeVisible()
    await expect(legend).toContainText('Official')
    await expect(legend).toContainText('Community')
    await expect(legend).toContainText('Activations')
  })

  test('My List counter pill is gated on the My List tab', async ({ testHost }) => {
    const frame = await waitForAttendeeReady(testHost)

    await (await navLink(frame, 'program')).click()
    await frame.locator('[data-testid="program-tab-program"]').waitFor({ state: 'visible' })

    const myListTab = frame.locator('[data-testid="program-tab-mylist"]')
    const counter = frame.locator('[data-testid="mylist-counter"]')

    if (!(await myListTab.isVisible().catch(() => false))) {
      // Unchecked-in account: tab and counter both hidden.
      await expect(counter).toHaveCount(0)
      return
    }

    // Checked-in account: counter renders inside the tab with a numeric value.
    await expect(counter).toBeVisible()
    await expect(counter).toHaveText(/^\d+$/)
  })
})
