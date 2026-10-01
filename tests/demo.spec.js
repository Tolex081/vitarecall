import { test, expect, isolateFonts } from "./browser-fixtures.js";

const nav = (page, name, mobile = false) => page.getByRole("navigation", { name: mobile ? "Mobile navigation" : "Primary navigation", exact: true }).getByRole("button", { name, exact: true });
const newUsername = () => "demo" + Date.now().toString(36) + Math.random().toString(36).slice(2, 4);

async function createDemo(page, role = "patient", { photo = false, prefixAt = false, automaticMemory = true } = {}) {
  const username = newUsername();
  await page.route("**/api/avatar/twitter/**", route => route.fulfill(photo
    ? { contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="#dceee5"/><circle cx="48" cy="36" r="18" fill="#275f54"/><path d="M16 96v-8a32 32 0 0 1 64 0v8" fill="#275f54"/></svg>' }
    : { status: 404, body: "" }));
  await page.goto("/");
  await expect(page.getByLabel("X / Twitter username", { exact: true })).toHaveAttribute("placeholder", "yourusername");
  await page.getByLabel("X / Twitter username", { exact: true }).fill(prefixAt ? "@" + username : username);
  if (role === "clinician") await page.getByText("Clinician", { exact: true }).click();
  await expect(page.getByLabel("Clinic invitation code", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Email address", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Save chats to Walrus automatically", exact: true })).toBeChecked();
  if (!automaticMemory) await page.getByRole("checkbox", { name: "Save chats to Walrus automatically", exact: true }).uncheck();
  await page.getByRole("button", { name: "Start chatting with Vita", exact: true }).click();
  const recovery = page.getByRole("region", { name: "Save your recovery code", exact: true });
  await expect(recovery).toBeVisible();
  const recoveryCode = await recovery.locator("code").innerText();
  await expect(page.getByLabel("Message Vita", { exact: true })).toBeVisible();
  return { username, recoveryCode };
}

for (const [device, width, height] of [["desktop", 1280, 900], ["mobile", 320, 800]]) {
  test(`${device}: avatar greeting and sign-out support isolated demo usernames`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const mobile = device === "mobile";
    const { username, recoveryCode } = await createDemo(page, "patient", { photo: true, prefixAt: true });
    await page.getByRole("button", { name: "I've saved my code", exact: true }).click();
    await expect(page.getByRole("heading", { name: `Hello, ${username}.`, exact: true })).toBeVisible();
    const avatar = page.locator(".greeting-line").getByRole("img", { name: `${username}'s X avatar`, exact: true });
    await expect(avatar).toBeVisible();
    await expect(avatar.locator("img")).toHaveAttribute("src", `/api/avatar/twitter/${username}`);
    await expect(avatar.locator("img")).toHaveClass("is-loaded");
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
    await page.screenshot({ path: `test-results/demo-avatar-${device}.png`, fullPage: true });
    const firstPatients = await (await page.request.get("/api/patients")).json();
    const firstId = firstPatients.patients[0].id;
    const note = `Fictional note belonging only to ${username}.`;
    await nav(page, "Notes & care plan", mobile).click();
    await page.getByLabel("New care note", { exact: true }).fill(note);
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(page.getByText("Care note saved.", { exact: true })).toBeVisible();
    await nav(page, "Chat with Vita", mobile).click();
    await page.getByLabel("Message Vita", { exact: true }).fill("Unsent draft for the first demo only.");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    const input = page.getByLabel("X / Twitter username", { exact: true });
    await expect(input).toHaveValue("");
    await expect(input).toHaveAttribute("placeholder", "yourusername");
    await expect(input).toBeFocused();
    await expect(page.getByRole("status")).toContainText(`Signed out of ${username}.`);
    await expect(page.getByRole("status")).toContainText("private recovery code");

    // A failed avatar request must show initials, never the previous user's photo.
    await page.route("**/api/avatar/twitter/**", route => route.fulfill({ status: 404, body: "" }));
    const secondUsername = newUsername();
    await input.fill(secondUsername);
    await page.getByRole("button", { name: "Start chatting with Vita", exact: true }).click();
    await expect(page.getByRole("heading", { name: `Hello, ${secondUsername}.`, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "I've saved my code", exact: true }).click();
    const fallback = page.locator(".greeting-line").getByRole("img", { name: `${secondUsername}'s X avatar`, exact: true });
    await expect(fallback.locator("img")).toHaveCount(0);
    await expect(fallback).toHaveText(secondUsername.slice(0, 2).toUpperCase());
    await expect(page.getByLabel("Message Vita", { exact: true })).toHaveValue("");
    expect((await page.request.get(`/api/patients/${firstId}/workspace`)).status()).toBe(404);
    await page.reload();
    await expect(page.getByRole("heading", { name: `Hello, ${secondUsername}.`, exact: true })).toBeVisible();
    await nav(page, "Notes & care plan", mobile).click();
    await expect(page.getByText(note, { exact: true })).toHaveCount(0);

    // Signing out preserves the previous profile and its saved app data.
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByRole("button", { name: "Restore demo", exact: true }).click();
    await page.getByLabel("X / Twitter username", { exact: true }).fill(username);
    await page.getByLabel("Private recovery code", { exact: true }).fill(recoveryCode);
    await page.getByRole("button", { name: "Restore my workspace", exact: true }).click();
    await expect(page.getByRole("heading", { name: `Hello, ${username}.`, exact: true })).toBeVisible();
    await nav(page, "Notes & care plan", mobile).click();
    await expect(page.getByText(note, { exact: true })).toBeVisible();
  });
}

test("clinician demo needs no invite and restores the same workspace with a private code", async ({ page, browser }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const { username, recoveryCode } = await createDemo(page, "clinician");
  await expect(page.getByRole("button", { name: "Link a patient", exact: true })).toHaveCount(0);
  await expect(page.getByText("Which fictional patient are we discussing", { exact: false })).toBeVisible();
  await nav(page, "Settings").click();
  const consent = page.getByRole("checkbox", { name: "Allow reviewed memory saves", exact: true });
  await expect(consent).toBeEnabled();
  await consent.click();
  await expect(consent).toBeChecked();
  await page.getByRole("button", { name: "I've saved my code", exact: true }).click();
  const patientName = await page.getByLabel("Patient workspace", { exact: true }).inputValue();
  expect(await page.evaluate(() => Object.values(localStorage))).not.toContain(recoveryCode);
  const otherDevice = await browser.newContext();
  await isolateFonts(otherDevice);
  try {
    const restorePage = await otherDevice.newPage();
    await restorePage.route("**/api/avatar/twitter/**", route => route.fulfill({ status: 404, body: "" }));
    await restorePage.goto("/");
    await restorePage.getByRole("button", { name: "Restore demo", exact: true }).click();
    await restorePage.getByLabel("X / Twitter username", { exact: true }).fill(username);
    await restorePage.getByLabel("Private recovery code", { exact: true }).fill(recoveryCode);
    await restorePage.getByRole("button", { name: "Restore my workspace", exact: true }).click();
    await expect(restorePage.getByLabel("Message Vita", { exact: true })).toBeVisible();
    await expect(restorePage.getByLabel("Patient workspace", { exact: true })).toHaveValue(patientName);
    await expect(restorePage.getByRole("region", { name: "Save your recovery code", exact: true })).toHaveCount(0);
    await nav(restorePage, "Settings").click();
    await expect(restorePage.getByRole("checkbox", { name: "Allow reviewed memory saves", exact: true })).toBeChecked();
  } finally { await otherDevice.close(); }
  expect(errors).toEqual([]);
});

test.describe("isolated demo memory fixture — no live Walrus or Gemini requests", () => {
  test.use({ baseURL: "http://127.0.0.1:3188" });
  test("reviewed memory survives a fresh conversation without previous chat history", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await createDemo(page, "patient", { automaticMemory: false });
    await page.getByRole("button", { name: "I've saved my code", exact: true }).click();
    const detail = "FICTIONAL TEST: Call me Ada. I prefer short appointment summaries.";
    await page.getByLabel("Message Vita", { exact: true }).fill(detail);
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.locator(".chat-message.assistant")).toContainText("no remembered context yet");
    await expect(page.locator(".memory-trace")).toContainText("no matching memory");
    await expect(page.getByRole("button", { name: "Remember this", exact: true })).toHaveCount(0);
    await nav(page, "Patient memory", true).click();
    await page.getByRole("textbox", { name: "Memory to save", exact: true }).fill(detail);
    await expect(page.getByRole("button", { name: "Save reviewed memory", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Allow reviewed memory saves", exact: true }).click();
    await page.getByRole("button", { name: "Save reviewed memory", exact: true }).click();
    await expect(page.getByText("Stored on Walrus", { exact: true })).toBeVisible({ timeout: 15000 });
    const blob = await page.locator(".memory-record .receipt-line").filter({ has: page.getByText("Blob ID", { exact: true }) }).locator("code").innerText();
    expect(blob).toMatch(/^fixture-blob-/);
    await nav(page, "Chat with Vita", true).click();
    await page.getByRole("button", { name: "New conversation", exact: true }).click();
    await expect(page.locator(".chat-message")).toHaveCount(0);
    await page.reload();
    await expect(page.getByLabel("Message Vita", { exact: true })).toBeVisible();
    await expect(page.locator(".chat-message")).toHaveCount(0);
    await page.getByLabel("Message Vita", { exact: true }).fill("What do you remember about my care preferences?");
    const responsePromise = page.waitForResponse(response => response.url().endsWith("/chat") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    const response = await responsePromise;
    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    expect(result.assistantMessage.memoryTrace).toMatchObject({ status: "recalled", sourceCount: 1, historyUsed: false });
    await expect(page.locator(".chat-message.assistant")).toContainText(detail);
    await expect(page.locator(".memory-trace")).toContainText("No previous chat history sent");
    await page.locator(".message-sources summary").click();
    await expect(page.locator(".message-sources code")).toHaveText(blob);
    const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
    await page.screenshot({ path: "test-results/demo-fixture-fresh-recall-mobile.png", fullPage: true });
  });
});
