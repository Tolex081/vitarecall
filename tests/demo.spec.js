import { test, expect } from "@playwright/test";

const nav = (page, name, mobile = false) => page.getByRole("navigation", { name: mobile ? "Mobile navigation" : "Primary navigation", exact: true }).getByRole("button", { name, exact: true });
const newUsername = () => "demo" + Date.now().toString(36) + Math.random().toString(36).slice(2, 4);

async function createDemo(page, role = "patient") {
  const username = newUsername();
  await page.route("**/api/avatar/twitter/**", route => route.fulfill({ status: 404, body: "" }));
  await page.goto("/");
  await page.getByLabel("X / Twitter username", { exact: true }).fill(username);
  if (role === "clinician") await page.getByText("Clinician", { exact: true }).click();
  await expect(page.getByLabel("Clinic invitation code", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Email address", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Start chatting with Vita", exact: true }).click();
  const recovery = page.getByRole("region", { name: "Save your recovery code", exact: true });
  await expect(recovery).toBeVisible();
  const recoveryCode = await recovery.locator("code").innerText();
  await expect(page.getByLabel("Message Vita", { exact: true })).toBeVisible();
  return { username, recoveryCode };
}

test("clinician demo needs no invite and restores the same workspace with a private code", async ({ page, browser }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const { username, recoveryCode } = await createDemo(page, "clinician");
  await expect(page.getByRole("button", { name: "Link a patient", exact: true })).toHaveCount(0);
  await expect(page.getByText("Which fictional patient are we discussing", { exact: false })).toBeVisible();
  await nav(page, "Settings").click();
  const consent = page.getByRole("checkbox", { name: "Allow Walrus Memory saves", exact: true });
  await expect(consent).toBeEnabled();
  await consent.click();
  await expect(consent).toBeChecked();
  await page.getByRole("button", { name: "I've saved my code", exact: true }).click();
  const patientName = await page.getByLabel("Patient workspace", { exact: true }).inputValue();
  expect(await page.evaluate(() => Object.values(localStorage))).not.toContain(recoveryCode);
  const otherDevice = await browser.newContext();
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
    await expect(restorePage.getByRole("checkbox", { name: "Allow Walrus Memory saves", exact: true })).toBeChecked();
  } finally { await otherDevice.close(); }
  expect(errors).toEqual([]);
});

test.describe("isolated demo memory fixture — no live Walrus or Gemini requests", () => {
  test.use({ baseURL: "http://127.0.0.1:3188" });
  test("reviewed memory survives a fresh conversation without previous chat history", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await createDemo(page);
    await page.getByRole("button", { name: "I've saved my code", exact: true }).click();
    const detail = "FICTIONAL TEST: Call me Ada. I prefer short appointment summaries.";
    await page.getByLabel("Message Vita", { exact: true }).fill(detail);
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.locator(".chat-message.assistant")).toContainText("no remembered context yet");
    await expect(page.locator(".memory-trace")).toContainText("no matching memory");
    await page.getByRole("button", { name: "Remember this", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Memory to save", exact: true })).toHaveValue(detail);
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
