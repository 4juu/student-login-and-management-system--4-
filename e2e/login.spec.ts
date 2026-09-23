import { test, expect } from '@playwright/test';

test.describe('Login page', () => {
  test('loads login form with Arabic labels', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#login-email')).toBeVisible();
    await expect(page.locator('#login-password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'تسجيل الدخول' })).toBeVisible();
    await expect(page.getByText('البريد الإلكتروني')).toBeVisible();
    await expect(page.getByText('كلمة المرور')).toBeVisible();
  });

  test('shows validation error when submitting empty form', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'تسجيل الدخول' }).click();
    await expect(page.getByText('الرجاء إدخال البريد الإلكتروني وكلمة المرور')).toBeVisible();
  });

  test('accepts typed credentials into fields', async ({ page }) => {
    await page.goto('/');
    await page.locator('#login-email').fill('teacher@example.com');
    await page.locator('#login-password').fill('secret123');
    await expect(page.locator('#login-email')).toHaveValue('teacher@example.com');
    await expect(page.locator('#login-password')).toHaveValue('secret123');
  });

  test('toggles password visibility', async ({ page }) => {
    await page.goto('/');
    await page.locator('#login-password').fill('secret123');
    await expect(page.locator('#login-password')).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'إظهار كلمة المرور' }).click();
    await expect(page.locator('#login-password')).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'إخفاء كلمة المرور' }).click();
    await expect(page.locator('#login-password')).toHaveAttribute('type', 'password');
  });

  test('shows error for invalid credentials (wrong password)', async ({ page }) => {
    await page.goto('/');
    await page.locator('#login-email').fill('teacher@example.com');
    await page.locator('#login-password').fill('wrong-password');
    await page.getByRole('button', { name: 'تسجيل الدخول' }).click();
    // Firebase auth error or generic login error should appear (not a crash)
    await expect(
      page.locator('.bg-red-500\\/15, .text-red-300').first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test('page is RTL and renders system title', async ({ page }) => {
    await page.goto('/');
    const dir = await page.locator('body, [dir]').first().getAttribute('dir');
    // login root has dir=rtl
    await expect(page.locator('[dir="rtl"]').first()).toBeAttached();
    void dir;
    await expect(page.locator('h1')).toBeVisible();
  });
});
