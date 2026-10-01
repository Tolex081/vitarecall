import { test, expect, isolateFonts } from './browser-fixtures.js';

test.use({ baseURL: 'http://127.0.0.1:3188' });
for (const [device, width] of [['desktop', 1280], ['mobile', 320]]) {
  test(`${device}: complete chat archive survives clear and restores on another device`, async ({ page, browser }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/api/avatar/twitter/**', route => route.fulfill({ status: 404, body: '' }));
    const username = 'arc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4);
    await page.goto('/');
    await page.getByLabel('X / Twitter username', { exact: true }).fill(username);
    await page.getByRole('button', { name: 'Start chatting with Vita', exact: true }).click();
    const recovery = await page.locator('.recovery-code code').innerText();
    await page.getByRole('button', { name: "I've saved my code", exact: true }).click();
    const control = page.getByRole('region', { name: 'Automatic conversation memory', exact: true });
    if (device === 'mobile') await page.getByRole('button', { name: 'Open memory settings', exact: true }).click();
    await expect(control.getByText('Off', { exact: true })).toBeVisible();
    if (device === 'mobile') await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('button', { name: 'Chat with Vita', exact: true }).click();
    await page.getByLabel('Message Vita', { exact: true }).fill('Fictional patient Mira prefers beans and short examples.');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.locator('.chat-message')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Remember this', exact: true })).toHaveCount(0);
    if (device === 'mobile') await expect(page.getByRole('button', { name: 'Open memory settings' })).toContainText('0 saved');
    else await expect(control).toContainText('0 confirmed chat parts');
    await page.getByRole('button', { name: 'New conversation', exact: true }).click();
    await expect(page.locator('.chat-message')).toHaveCount(0);
    if (device === 'mobile') await page.getByRole('button', { name: 'Open memory settings', exact: true }).click();
    await control.getByRole('button', { name: 'Enable automatic memory', exact: true }).click();
    await expect(control.getByText('On', { exact: true })).toBeVisible();
    const nav = page.getByRole('navigation', { name: device === 'mobile' ? 'Mobile navigation' : 'Primary navigation', exact: true });
    await nav.getByRole('button', { name: 'Patient memory', exact: true }).click();
    await page.getByRole('button', { name: 'Also save earlier chats', exact: true }).click();
    await expect(control).toContainText('1 confirmed chat part on Walrus', { timeout: 20000 });
    await page.locator('.conversation-receipts > summary').click();
    await expect(page.locator('.conversation-receipts')).toContainText('fixture-blob-');
    await page.locator('.conversation-receipts .memory-record details summary').click();
    await expect(page.locator('.archived-text')).toContainText('Mira');
    await expect(page.locator('.archived-text')).toContainText('Vita AI-generated');
    await page.getByRole('button', { name: 'Also save earlier chats', exact: true }).click();
    await expect(control).toContainText('1 confirmed chat part on Walrus');
    await page.screenshot({ path: `test-results/automatic-memory-${device}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();

    const other = await browser.newContext({ baseURL: 'http://127.0.0.1:3188', viewport: { width, height: 900 } });
    await isolateFonts(other);
    const restored = await other.newPage();
    await restored.route('**/api/avatar/twitter/**', route => route.fulfill({ status: 404, body: '' }));
    try {
      await restored.goto('/');
      await restored.getByRole('button', { name: 'Restore demo', exact: true }).click();
      await restored.getByLabel('X / Twitter username', { exact: true }).fill(username);
      await restored.getByLabel('Private recovery code', { exact: true }).fill(recovery);
      await restored.getByRole('button', { name: 'Restore my workspace', exact: true }).click();
      await expect(restored.locator('.chat-message')).toHaveCount(0);
      await restored.getByLabel('Message Vita', { exact: true }).fill('What do you remember about me?');
      const response = restored.waitForResponse(r => r.url().endsWith('/chat') && r.request().method() === 'POST');
      await restored.getByRole('button', { name: 'Send message', exact: true }).click();
      const result = await (await response).json();
      expect(result.assistantMessage.memoryTrace).toMatchObject({ status: 'recalled', historyUsed: false, sourceCount: 1 });
      await expect(restored.locator('.chat-message.assistant')).toContainText('Mira');
      if (device === 'mobile') await expect(restored.getByRole('button', { name: 'Open memory settings' })).toContainText('2 saved', { timeout: 20000 });
      else await expect(restored.getByRole('region', { name: 'Automatic conversation memory' })).toContainText('2 confirmed chat parts on Walrus', { timeout: 20000 });
      await restored.getByRole('button', { name: 'New conversation', exact: true }).click();
      await expect(restored.locator('.chat-message')).toHaveCount(0);
      if (device === 'mobile') await restored.getByRole('button', { name: 'Open memory settings', exact: true }).click();
      await restored.getByRole('button', { name: 'Pause automatic memory', exact: true }).click();
      await expect(restored.getByRole('button', { name: 'Enable automatic memory', exact: true })).toBeVisible();
      if (device === 'mobile') await restored.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('button', { name: 'Chat with Vita', exact: true }).click();
      await restored.screenshot({ path: `test-results/automatic-recall-${device}.png`, fullPage: true });
    } finally { await other.close(); }
  });
}
