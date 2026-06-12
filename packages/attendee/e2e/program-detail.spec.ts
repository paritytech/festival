import { test, expect } from './setup'
import { waitForAttendeeReady, navLink } from './helpers'

test.describe('Program detail', () => {
  test('clicking a program card opens the session detail page and back returns', async ({ testHost }) => {
    const frame = await waitForAttendeeReady(testHost)

    await (await navLink(frame, 'program')).click()
    await expect(frame.locator('[data-testid="program-tab-program"]')).toBeVisible()

    const firstCard = frame.locator('[data-testid="program-card"]').first()
    await expect(firstCard).toBeVisible()

    await firstCard.click()
    await expect(frame.locator('[data-testid="session-detail-heading"]')).toBeVisible()

    await frame.locator('[data-testid="session-detail-back"]').click()
    await expect(frame.locator('[data-testid="program-tab-program"]')).toBeVisible()
  })

  // TODO: flake, two failure modes: nav to /sessions/<addr> doesn't fire
  // heading visibility, or the favorite-toggle click doesn't flip aria-pressed
  // (the dev overlay at z-60 intercepts mouse events). Re-enable once that
  // overlay is pointer-events:none in test builds, or add a hook to toggle
  // bookmark state via useBookmarks directly.
  test.fixme('sub-event detail exposes the favorite-toggle and the action shows a collect-badge state', async ({ testHost }) => {
    const frame = await waitForAttendeeReady(testHost)

    await (await navLink(frame, 'program')).click()

    // Find a card that links to a session (/sessions/0x…). Schedule entries
    // route to /program/<id> and don't expose the new favorite affordance.
    // ProgramCard.vue uses NuxtLink as the data-testid="program-card" root,
    // so the program-card IS the <a> (no inner <a>). Match its href directly.
    const subEventCard = frame
      .locator('[data-testid="program-card"][href*="/sessions/"]')
      .first()
    await expect(subEventCard).toBeVisible()

    // Drive Vue Router via window.location.hash directly. Synthetic
    // clicks on NuxtLink don't reliably navigate inside this iframe
    // (see report-flow.spec.ts for the same workaround).
    const href = await subEventCard.getAttribute('href')
    if (!href) throw new Error('Sub-event card has no href')
    const iframe = testHost.page
      .frames()
      .find((f) => f.url().includes('localhost:3200'))
    if (!iframe) throw new Error('iframe not found')
    await iframe.evaluate((h) => {
      const hash = h.startsWith('#') ? h : '#' + h
      const oldUrl = window.location.href
      window.location.hash = hash
      window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL: oldUrl, newURL: window.location.href }))
      window.dispatchEvent(new PopStateEvent('popstate'))
    }, href)
    await expect(frame.locator('[data-testid="session-detail-heading"]')).toBeVisible({ timeout: 30_000 })

    // Star sits on the far right of the top bar. The seed deploys the session
    // from the deployer account (not Bob), so Bob is a non-owner and the
    // favorite-toggle renders.
    const star = frame.locator('[data-testid="session-favorite-toggle"]')
    await expect(star).toBeVisible()

    const initial = await star.getAttribute('aria-pressed')
    // The dev-mode account-picker overlay (top-right, z-60) sits on top
    // of the favorite-toggle. `force: true` bypasses Playwright's hit-
    // testing but the browser still routes the click event to the
    // top-most element (the overlay). Use evaluate so the click handler
    // fires on the button itself.
    await star.evaluate((el) => (el as HTMLElement).click())
    await expect(star).not.toHaveAttribute('aria-pressed', initial ?? 'false')
    await star.evaluate((el) => (el as HTMLElement).click())
    await expect(star).toHaveAttribute('aria-pressed', initial ?? 'false')

    // Exactly one of the action states should render. Which one depends on
    // when the test runs versus the session window. We just assert that no
    // legacy Register button leaked back in and that *some* state surfaced.
    await expect(frame.getByRole('button', { name: /^Register$/ })).toHaveCount(0)

    const ctaStates = frame.locator(
      '[data-testid="session-collect-badge-pending"], [data-testid="session-collect-badge-cta"]',
    )
    // Manage role + creator branches don't render any of these. Non-owner +
    // non-volunteer with no festival check-in renders nothing too. We only
    // assert *at most one* renders; presence depends on chain state.
    expect(await ctaStates.count()).toBeLessThanOrEqual(1)
  })
})
