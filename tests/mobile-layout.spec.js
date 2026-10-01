import { test, expect } from './browser-fixtures.js';

test.use({ baseURL: 'http://127.0.0.1:3188' });
const mobileNav = (page, name) => page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('button', { name, exact: true });
async function start(page) {
  await page.route('**/api/avatar/twitter/**', route => route.fulfill({ status: 404, body: '' }));
  await page.goto('/');
  await page.getByLabel('X / Twitter username', { exact: true }).fill('phone' + Date.now().toString(36));
  await page.getByRole('button', { name: 'Start chatting with Vita', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Save your recovery code' })).toBeVisible();
  await page.getByRole('button', { name: "I've saved my code", exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/compact-chat/);
}
async function fits(page, visibleHeight) {
  const box = await page.getByLabel('Message Vita', { exact: true }).boundingBox();
  const send = await page.getByRole('button', { name: 'Send message', exact: true }).boundingBox();
  const limit = visibleHeight || (await page.getByRole('navigation', { name: 'Mobile navigation' }).boundingBox()).y;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(limit);
  expect(send.y + send.height).toBeLessThanOrEqual(limit);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
for (const [width, height] of [[320, 568], [390, 844], [430, 932]]) {
  test(`phone ${width}: chat fits without desktop clutter and keeps full memory access`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await start(page);
    await expect(page.locator('.welcome-card')).toBeHidden();
    await expect(page.locator('.context-column')).toBeHidden();
    await expect(page.locator('.mobile-chat-safety')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open memory settings' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
    await fits(page);
    expect(await page.getByLabel('Message Vita').evaluate(el => getComputedStyle(el).fontSize)).toBe('16px');
    await page.screenshot({ path: `test-results/mobile-chat-${width}.png`, fullPage: true });

    await page.getByLabel('Message Vita').fill('Unsent fictional draft');
    await page.getByRole('button', { name: 'Open memory settings' }).click();
    const memory = page.getByRole('region', { name: 'Automatic conversation memory' });
    await expect(memory).toBeVisible();
    await expect(memory).toContainText('processes plaintext before encryption');
    await memory.getByRole('button', { name: 'Enable automatic memory' }).click();
    await mobileNav(page, 'Chat with Vita').click();
    await expect(page.getByLabel('Message Vita')).toHaveValue('Unsent fictional draft');
    await expect(page.getByRole('button', { name: 'Open memory settings' })).toContainText('auto on');
    await page.getByLabel('Message Vita').fill('UI-only long mobile layout fixture');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.locator('.chat-message.assistant')).toBeVisible();
    await fits(page);
    expect(await page.locator('.conversation').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    await page.screenshot({ path: `test-results/mobile-reply-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'New conversation', exact: true }).click();
    await expect(page.locator('.chat-message')).toHaveCount(0);
    await fits(page);
    await mobileNav(page, 'Settings').click();
    await expect(page.getByRole('heading', { name: 'Memory & privacy', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByLabel('X / Twitter username', { exact: true })).toHaveValue('');
  });
}
test('keyboard-sized viewport keeps the composer visible and restores navigation on blur', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  await page.getByLabel('Message Vita').focus();
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => 380 });
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  await expect(page.locator('.app-shell')).toHaveClass(/keyboard-open/);
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeHidden();
  await fits(page, 380);
  await page.screenshot({ path: 'test-results/mobile-keyboard-simulation.png' });
  await page.evaluate(() => {
    document.activeElement.blur();
    delete window.visualViewport.height;
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  await expect(page.locator('.app-shell')).not.toHaveClass(/keyboard-open/);
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
  await fits(page);
  await page.setViewportSize({ width: 667, height: 375 });
  await fits(page);
});
