import { test, expect } from '@playwright/test';

/**
 * Student CRUD E2E — requires an authenticated admin session.
 *
 * These tests are skipped unless E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD are set
 * (real Firebase credentials stay out of the repo).
 *
 * Run: E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... npx playwright test student-crud
 */
const adminEmail = process.env.E2E_ADMIN_EMAIL;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
const maybe = adminEmail && adminPassword ? test : test.skip;

test.describe('Student CRUD', () => {
  maybe('admin can open student management after login', async ({ page }) => {
    await page.goto('/');
    await page.locator('#login-email').fill(adminEmail!);
    await page.locator('#login-password').fill(adminPassword!);
    await page.getByRole('button', { name: 'تسجيل الدخول' }).click();

    // After login the stage selector or dashboard should appear
    await expect(
      page.getByText('إلى أين نتوجه اليوم؟').or(page.getByText('إدارة الطلاب')),
    ).toBeVisible({ timeout: 30_000 });
  });

  maybe('admin can reach student manager and see add form', async ({ page }) => {
    await page.goto('/');
    await page.locator('#login-email').fill(adminEmail!);
    await page.locator('#login-password').fill(adminPassword!);
    await page.getByRole('button', { name: 'تسجيل الدخول' }).click();

    // navigate to a stage if stage selector appears
    const stageBtn = page.getByRole('button', { name: /دخول/ }).first();
    if (await stageBtn.isVisible().catch(() => false)) {
      await stageBtn.click();
    }

    // open students tab if present
    const studentsTab = page.getByRole('button', { name: /الطلاب/ }).first();
    if (await studentsTab.isVisible().catch(() => false)) {
      await studentsTab.click();
    }

    await expect(page.getByText('إدارة الطلاب')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByPlaceholder('أدخل اسم الطالب')).toBeVisible();
    await expect(page.getByPlaceholder('1001')).toBeVisible();
  });
});
