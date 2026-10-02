import { test, expect } from './browser-fixtures.js';

test.use({ baseURL: 'http://127.0.0.1:3188' });
const send = page => page.getByRole('button', { name: 'Send message', exact: true });
const composer = page => page.getByLabel('Message Vita', { exact: true });
async function start(page) {
  await page.route('**/api/avatar/twitter/**', route => route.fulfill({ status: 404, body: '' }));
  await page.goto('/');
  await page.getByLabel('X / Twitter username', { exact: true }).fill('chat' + Date.now().toString(36));
  await page.getByRole('checkbox', { name: 'Save chats to Walrus automatically', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Start chatting with Vita', exact: true }).click();
  await page.getByRole('button', { name: "I've saved my code", exact: true }).click();
  await expect(composer(page)).toBeVisible();
}

// Hold only delivery to the browser; the isolated fixture really handles the
// request. No live Gemini calls, real patient data or mainnet writes are used.
async function holdReply(page) {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const requests = [];
  await page.route('**/api/patients/*/chat', async route => {
    requests.push(route.request().postDataJSON());
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  return { release, requests };
}

for (const [width, height] of [[390, 844], [1440, 1000]]) {
  test(`${width}: send appears immediately, blocks double submit, and preserves the next draft`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await start(page);
    const held = await holdReply(page);
    try {
      await composer(page).fill('My fictional appointment-preparation question.');
      await send(page).click();
      await expect(composer(page)).toHaveValue('');
      await expect(page.locator('.chat-message.user')).toHaveCount(1);
      await expect(page.locator('.chat-message.user')).toContainText('My fictional appointment-preparation question.');
      await expect(page.locator('.message-delivery')).toContainText('Waiting for Vita');
      await expect(page.locator('.chat-message.assistant')).toHaveCount(0);
      await page.screenshot({ path: `test-results/instant-send-${width}.png` });
      await composer(page).fill('A new draft typed while waiting.');
      await composer(page).press('Enter');
      await expect(send(page)).toBeDisabled();
      await expect.poll(() => held.requests.length).toBe(1);
      held.release();
      await expect(page.locator('.chat-message.assistant')).toHaveCount(1);
      await expect(page.locator('.chat-message.user')).toHaveCount(1);
      await expect(page.locator('.message-delivery')).toHaveCount(0);
      await expect(composer(page)).toHaveValue('A new draft typed while waiting.');
      await expect(send(page)).toBeEnabled();
    } finally { held.release(); }
  });

  test(`${width}: a new reply does not pull the reader away from older messages`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await start(page);
    await composer(page).fill('UI-only long mobile layout fixture');
    await send(page).click();
    await expect(page.locator('.chat-message.assistant')).toHaveCount(1);
    const held = await holdReply(page);
    try {
      await composer(page).fill('A fictional follow-up with a delayed reply.');
      await send(page).click();
      await expect(page.locator('.message-delivery')).toBeVisible();
      const conversation = page.locator('.conversation');
      expect(await conversation.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(200);
      await conversation.evaluate(el => { el.scrollTop = 90; el.dispatchEvent(new Event('scroll')); });
      const readingTop = await conversation.evaluate(el => el.scrollTop);
      held.release();
      await expect(page.locator('.chat-message.assistant')).toHaveCount(2);
      await expect(page.getByRole('button', { name: /New reply · Jump to latest/ })).toBeVisible();
      expect(Math.abs(await conversation.evaluate(el => el.scrollTop) - readingTop)).toBeLessThan(3);
      // Unmounting chat for the memory tab must not reset the reader's position.
      const nav = page.getByRole('navigation', { name: width < 731 ? 'Mobile navigation' : 'Primary navigation', exact: true });
      await nav.getByRole('button', { name: 'Patient memory', exact: true }).click();
      await nav.getByRole('button', { name: 'Chat with Vita', exact: true }).click();
      expect(Math.abs(await conversation.evaluate(el => el.scrollTop) - readingTop)).toBeLessThan(3);
      await page.getByRole('button', { name: /New reply · Jump to latest/ }).click();
      await expect.poll(() => conversation.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(3);
      await expect(page.getByRole('button', { name: /New reply · Jump to latest/ })).toHaveCount(0);
      // Desktop wheel events must escape the inner scroller at its boundary.
      expect(await conversation.evaluate(el => getComputedStyle(el).overscrollBehaviorY)).toBe(width < 731 ? 'contain' : 'auto');
      expect(await conversation.evaluate(el => getComputedStyle(el).scrollBehavior)).toBe('auto');
    } finally { held.release(); }
  });
}

test('a lost response retries the same request ID without duplicating the server exchange', async ({ page }) => {
  await start(page);
  const requests = [];
  await page.route('**/api/patients/*/chat', async route => {
    requests.push(route.request().postDataJSON());
    const response = await route.fetch();
    if (requests.length === 1) await route.abort('failed');
    else await route.fulfill({ response });
  });
  await composer(page).fill('Fictional lost-response example.');
  await send(page).click();
  await expect(page.getByText('Reply not confirmed.', { exact: true })).toBeVisible();
  await expect(page.locator('.chat-message.user')).toHaveCount(1);
  await composer(page).fill('Keep this unrelated draft.');
  await page.getByRole('button', { name: 'Retry message', exact: true }).click();
  await expect(page.locator('.chat-message.assistant')).toHaveCount(1);
  await expect(page.locator('.chat-message.user')).toHaveCount(1);
  expect(requests).toHaveLength(2);
  expect(requests[1].requestId).toBe(requests[0].requestId);
  await expect(composer(page)).toHaveValue('Keep this unrelated draft.');
  await page.reload();
  await expect(page.locator('.chat-message')).toHaveCount(2);
});

test('starting a new conversation clears a stale new-reply indicator', async ({ page }) => {
  await start(page);
  await composer(page).fill('UI-only long mobile layout fixture');
  await send(page).click();
  await expect(page.locator('.chat-message.assistant')).toHaveCount(1);
  const held = await holdReply(page);
  try {
    await composer(page).fill('One more fictional follow-up.');
    await send(page).click();
    await expect(page.locator('.message-delivery')).toBeVisible();
    await page.locator('.conversation').evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
    held.release();
    await expect(page.getByRole('button', { name: /New reply · Jump to latest/ })).toBeVisible();
    await page.getByRole('button', { name: 'New conversation', exact: true }).click();
    await expect(page.locator('.chat-message')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /New reply · Jump to latest/ })).toHaveCount(0);
  } finally { held.release(); }
});

test('a confirmed provider failure can be retried after another exchange without wrong chronology', async ({ page }) => {
  await start(page);
  const failedText = 'UI-only fail-once: ' + Date.now();
  const requests = [];
  page.on('request', request => { if (request.url().endsWith('/chat') && request.method() === 'POST') requests.push(request.postDataJSON()); });
  await composer(page).fill(failedText);
  await send(page).click();
  await expect(page.getByText('Reply not confirmed.', { exact: true })).toBeVisible();
  await composer(page).fill('A different fictional question before retrying.');
  await send(page).click();
  await expect(page.locator('.chat-message.assistant')).toHaveCount(1);
  await page.getByRole('button', { name: 'Retry message', exact: true }).click();
  await expect(page.locator('.chat-message.assistant')).toHaveCount(2);
  await expect(page.locator('.chat-message.user').last()).toContainText(failedText);
  expect(requests).toHaveLength(3);
  expect(requests[2].requestId).toBe(requests[0].requestId);
  await expect(page.getByText('Reply not confirmed.', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.chat-message')).toHaveCount(4);
  await expect(page.locator('.chat-message.user').last()).toContainText(failedText);
});
