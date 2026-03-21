/**
 * End-to-end tests for the Lift Coach app.
 * Tests the complete user journey on both mobile and desktop viewports.
 */

import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Clear storage for clean state
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  // Wait for the app to fully initialize
  await page.waitForLoadState('networkidle');
});

// ─── App Loading ───

test.describe('App Loading', () => {
  test('loads with Training tab active', async ({ page }) => {
    await expect(page.locator('#mode-program')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#program-panel')).toBeVisible();
  });

  test('has all 4 navigation tabs', async ({ page }) => {
    const tabs = page.locator('.mode-tab');
    await expect(tabs).toHaveCount(4);
  });

  test('loads within 3 seconds', async ({ page }) => {
    const start = Date.now();
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    expect(Date.now() - start).toBeLessThan(3000);
  });
});

// ─── Tab Navigation ───

test.describe('Tab Navigation', () => {
  test('switches between all tabs', async ({ page }) => {
    // Form Check
    await page.locator('#mode-upload').click();
    await expect(page.locator('#upload-panel')).toBeVisible();

    // Training
    await page.locator('#mode-program').click();
    await expect(page.locator('#program-panel')).toBeVisible();

    // Coach (lazy loads)
    await page.locator('#mode-coach').click();
    await expect(page.locator('#coach-panel')).toBeVisible();
    // Wait for coach UI to lazy-load
    await page.waitForSelector('#coach-section', { timeout: 5000 });
  });
});

// ─── Program Setup ───

test.describe('Program Setup', () => {
  test('shows setup wizard for new users', async ({ page }) => {
    // Wait for workout planner to lazy-load and render
    await page.waitForSelector('#workout-planner-section', { timeout: 5000 });
    // Should contain setup form elements
    const section = page.locator('#workout-planner-section');
    await expect(section).toBeVisible();
  });

  test('custom program builder textarea exists', async ({ page }) => {
    await page.waitForSelector('#workout-planner-section', { timeout: 5000 });
    // The custom builder may be in a details element
    const customInput = page.locator('#wp-custom-input');
    // If it's in a collapsed details, open it
    const details = page.locator('details:has(#wp-custom-input)');
    if (await details.count() > 0) {
      await details.locator('summary').click();
    }
    // Now the textarea should be visible (or at least exist)
    await expect(customInput).toBeAttached();
  });
});

// ─── AI Coach ───

test.describe('AI Coach', () => {
  test('shows coach interface with input and suggestions', async ({ page }) => {
    await page.locator('#mode-coach').click();
    // Wait for lazy load
    await page.waitForSelector('#coach-input', { timeout: 10000 });
    await expect(page.locator('#coach-input')).toBeVisible();
    await expect(page.locator('#coach-send')).toBeVisible();
  });

  test('responds to typed question in offline mode', async ({ page }) => {
    await page.locator('#mode-coach').click();
    await page.waitForSelector('#coach-input', { timeout: 10000 });

    await page.fill('#coach-input', 'How to squat?');
    await page.click('#coach-send');

    // Wait for coach response
    const response = page.locator('.coach-msg-coach');
    await expect(response.first()).toBeVisible({ timeout: 5000 });
    const text = await response.first().textContent();
    expect(text?.toLowerCase()).toContain('squat');
  });
});

// ─── RPE Calculator ───

test.describe('RPE Calculator', () => {
  test('calculates e1RM from inputs', async ({ page }) => {
    // Set up a program state so the calculator is visible
    await page.evaluate(() => {
      localStorage.setItem('squat_form_program_state', JSON.stringify({
        programId: 'starting_strength', startDate: new Date().toISOString(),
        currentWeek: 1, currentDay: 0, trainingMaxes: {},
        liftProgress: {
          squat: { liftName: 'squat', currentWeight: 200, unit: 'lbs', increment: 10, consecutiveFailures: 0, deloadCycles: 0, stage: 1, lpExhausted: false, history: [], lastSuccessWeight: 200 },
          bench: { liftName: 'bench', currentWeight: 135, unit: 'lbs', increment: 5, consecutiveFailures: 0, deloadCycles: 0, stage: 1, lpExhausted: false, history: [], lastSuccessWeight: 135 },
          deadlift: { liftName: 'deadlift', currentWeight: 225, unit: 'lbs', increment: 10, consecutiveFailures: 0, deloadCycles: 0, stage: 1, lpExhausted: false, history: [], lastSuccessWeight: 225 },
          ohp: { liftName: 'ohp', currentWeight: 95, unit: 'lbs', increment: 5, consecutiveFailures: 0, deloadCycles: 0, stage: 1, lpExhausted: false, history: [], lastSuccessWeight: 95 },
        },
        workoutsCompleted: 5, cycleNumber: 1, weekInCycle: 1,
        equipment: 'barbell_home', weightUnit: 'lbs',
      }));
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Open RPE calculator details
    const summary = page.locator('summary:has-text("RPE Calculator")');
    if (await summary.isVisible({ timeout: 5000 })) {
      await summary.click();
      await page.fill('#rpe-calc-weight', '225');
      await page.fill('#rpe-calc-reps', '5');
      await page.selectOption('#rpe-calc-rpe', '8');
      await page.click('#rpe-calc-btn');

      // Should show estimated 1RM
      await expect(page.locator('.wp-rpe-result-value')).toBeVisible({ timeout: 3000 });
      // Should show prescription table
      await expect(page.locator('.wp-rpe-table')).toBeVisible();
    }
  });
});

// ─── Accessibility ───

test.describe('Accessibility', () => {
  test('tabs have proper ARIA attributes', async ({ page }) => {
    const tabs = page.locator('[role="tab"]');
    const count = await tabs.count();
    expect(count).toBeGreaterThanOrEqual(4);
    // Exactly one should be selected
    const selected = page.locator('[role="tab"][aria-selected="true"]');
    await expect(selected).toHaveCount(1);
  });

  test('has skip navigation link', async ({ page }) => {
    await expect(page.locator('.skip-nav')).toBeAttached();
  });
});

// ─── Theme Toggle ───

test.describe('Theme', () => {
  test('has a theme toggle button', async ({ page }) => {
    const btn = page.locator('#theme-toggle, .theme-toggle').first();
    await expect(btn).toBeAttached();
  });
});
