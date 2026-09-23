import { test, expect } from '@playwright/test';

/**
 * Attendance flow E2E — student-facing pages that don't require auth.
 * Covers: attendance.html report page shell + keypad login UI (when reachable).
 */
test.describe('Attendance flow', () => {
  test('attendance.html loads without crashing', async ({ page }) => {
    await page.goto('/attendance.html');
    await expect(page).toHaveTitle(/./); // non-empty title
    // page should render some Arabic content or a loading state
    await expect(page.locator('body')).not.toBeEmpty();
    // no uncaught fatal blank page
    const text = await page.locator('body').innerText();
    expect(text.length).toBeGreaterThan(0);
  });

  test('attendance page shows Arabic UI or handles missing session gracefully', async ({ page }) => {
    await page.goto('/attendance.html');
    await page.waitForLoadState('networkidle').catch(() => undefined);
    const bodyText = await page.locator('body').innerText();
    // either Arabic content, a form, or an error message — not empty
    expect(bodyText.trim().length).toBeGreaterThan(0);
    // should not show raw React error overlay text
    expect(bodyText).not.toContain('Unhandled Runtime Error');
    expect(bodyText).not.toContain('Minified React error');
  });

  test('register.html loads (self-registration entry)', async ({ page }) => {
    await page.goto('/register.html');
    await expect(page.locator('body')).not.toBeEmpty();
    const text = await page.locator('body').innerText();
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain('Minified React error');
  });

  test('face-test.html loads (face test entry)', async ({ page }) => {
    await page.goto('/face-test.html');
    await expect(page.locator('body')).not.toBeEmpty();
    const text = await page.locator('body').innerText();
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain('Minified React error');
  });
});
