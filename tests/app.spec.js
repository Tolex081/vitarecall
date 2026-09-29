import { test, expect } from "@playwright/test";

const password = "Browser test patient password";
async function register(page, email, name = "Ada Example") {
  await page.goto("/");
  await page.getByRole("button", { name: "Email account", exact: true }).click();
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByLabel("Your name", { exact: true }).fill(name);
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create my account", exact: true }).click();
  await expect(page.getByRole("heading", { name: `Hello, ${name.split(" ")[0]}.` })).toBeVisible();
  await expect(page.getByLabel("Message Vita", { exact: true })).toBeVisible();
}
const nav = (page, name, mobile = false) => page.getByRole("navigation", { name: mobile ? "Mobile navigation" : "Primary navigation", exact: true }).getByRole("button", { name, exact: true });

test("patient signup, notes, tasks, consent, logout and reload work with the real API", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const email = `patient-${Date.now()}@example.test`;
  await register(page, email);
  await expect(page.getByText("One more step to connect Vita")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
  await page.screenshot({ path: "test-results/patient-desktop.png", fullPage: true });

  await nav(page, "Notes & care plan").click();
  await page.getByLabel("New care note", { exact: true }).fill("Please help me prepare questions about my sleep routine.");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.getByText("Care note saved.", { exact: true })).toBeVisible();
  await page.getByLabel("New care task", { exact: true }).fill("Bring appointment questions");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("checkbox", { name: "Bring appointment questions", exact: true }).click();
  await expect(page.getByText("1/1 done", { exact: true })).toBeVisible();
  await page.reload();
  await nav(page, "Notes & care plan").click();
  await expect(page.getByText("Please help me prepare questions about my sleep routine.", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Bring appointment questions", exact: true })).toBeChecked();

  await nav(page, "Settings").click();
  await page.getByRole("checkbox", { name: "Allow Walrus Memory saves", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Allow Walrus Memory saves", exact: true })).toBeChecked();
  const careCode = await page.locator(".care-code code").innerText();
  await page.getByRole("button", { name: "Generate a new care code", exact: true }).click();
  await expect(page.locator(".care-code code")).not.toHaveText(careCode);
  await nav(page, "Patient memory").click();
  await page.getByLabel("Memory to save", { exact: true }).fill("I prefer plain-language summaries.");
  await expect(page.getByRole("button", { name: "Save reviewed memory", exact: true })).toBeDisabled();
  await expect(page.getByText("No memories saved yet", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Sign out", exact: true }).filter({ visible: true }).click();
  await page.getByRole("button", { name: "Email account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Welcome back.", exact: true })).toBeVisible();
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in to VitaRecall", exact: true }).click();
  await nav(page, "Notes & care plan").click();
  await expect(page.getByText("Please help me prepare questions about my sleep routine.", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("mobile chat is easy to find and the page fits the screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await register(page, `mobile-${Date.now()}@example.test`, "Nia Example");
  await expect(nav(page, "Chat with Vita", true)).toBeVisible();
  const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
  await page.screenshot({ path: "test-results/patient-mobile.png", fullPage: true });
  await nav(page, "Settings", true).click();
  await expect(page.getByRole("heading", { name: "Memory & privacy", exact: true })).toBeVisible();
  await nav(page, "Chat with Vita", true).click();
  await page.getByText("What do you remember about my care preferences?", { exact: true }).click();
  await expect(page.getByLabel("Message Vita", { exact: true })).toHaveValue("What do you remember about my care preferences?");
});

test("invited clinician links only a shared patient and patient can revoke access", async ({ browser }) => {
  const patientContext = await browser.newContext();
  const clinicianContext = await browser.newContext();
  const patientPage = await patientContext.newPage();
  const clinicianPage = await clinicianContext.newPage();
  try {
    await register(patientPage, `shared-${Date.now()}@example.test`, "Shared Example");
    await nav(patientPage, "Settings").click();
    const code = await patientPage.locator(".care-code code").innerText();
    await clinicianPage.goto("/");
    await clinicianPage.getByRole("button", { name: "Email account", exact: true }).click();
    await clinicianPage.getByRole("button", { name: "Create account", exact: true }).click();
    await clinicianPage.getByLabel("Your name", { exact: true }).fill("Dr Example");
    await clinicianPage.getByText("Clinician", { exact: true }).click();
    await clinicianPage.getByLabel("Email address", { exact: true }).fill(`doctor-${Date.now()}@example.test`);
    await clinicianPage.getByLabel("Password", { exact: true }).fill(password);
    await clinicianPage.getByLabel("Clinic invitation code", { exact: true }).fill("e2e-clinic-invite-only");
    await clinicianPage.getByRole("button", { name: "Create my account", exact: true }).click();
    await expect(clinicianPage.getByText("Start with a patient connection", { exact: true })).toBeVisible();
    await clinicianPage.getByRole("button", { name: "Link a patient", exact: true }).first().click();
    await clinicianPage.getByLabel("Patient care code", { exact: true }).fill(code);
    await clinicianPage.getByRole("button", { name: "Link patient workspace", exact: true }).click();
    await expect(clinicianPage.getByLabel("Patient workspace", { exact: true })).toHaveText("Shared Example");
    await expect(clinicianPage.getByLabel("Message Vita", { exact: true })).toBeVisible();
    await clinicianPage.screenshot({ path: "test-results/clinician-desktop.png", fullPage: true });

    await patientPage.reload();
    await nav(patientPage, "Settings").click();
    await expect(patientPage.locator(".care-team-list").getByText("Dr Example", { exact: true })).toBeVisible();
    await patientPage.getByRole("button", { name: "Remove access", exact: true }).click();
    await expect(patientPage.getByText("Clinician access removed and care code changed.", { exact: true })).toBeVisible();
    await clinicianPage.reload();
    await expect(clinicianPage.getByText("Start with a patient connection", { exact: true })).toBeVisible();
  } finally { await patientContext.close(); await clinicianContext.close(); }
});

test.describe("isolated provider fixture (no live writes)", () => {
  test.use({ baseURL: "http://127.0.0.1:3188" });
  test("reviewed memory becomes a receipt and is recalled in a later login", async ({ page }) => {
    const email = `remember-${Date.now()}@example.test`;
    await register(page, email, "Memory Example");
    await nav(page, "Settings").click();
    await page.getByRole("checkbox", { name: "Allow Walrus Memory saves", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: "Allow Walrus Memory saves", exact: true })).toBeChecked();
    await nav(page, "Patient memory").click();
    await page.getByLabel("Memory to save", { exact: true }).fill("I prefer short appointment summaries.");
    await page.getByRole("button", { name: "Save reviewed memory", exact: true }).click();
    await expect(page.getByText("Awaiting confirmation", { exact: true })).toBeVisible();
    await expect(page.getByText("Stored on Walrus", { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("fixture-blob-1", { exact: true })).toBeVisible();
    await expect(page.getByText("1 confirmed unique blob tracked for this patient in this app.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Sign out", exact: true }).filter({ visible: true }).click();
    await page.getByRole("button", { name: "Email account", exact: true }).click();
    await page.getByLabel("Email address", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in to VitaRecall", exact: true }).click();
    await page.getByLabel("Message Vita", { exact: true }).fill("What preferences do you remember?");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.locator(".chat-message.assistant")).toContainText("I prefer short appointment summaries.");
    await page.locator(".message-sources summary").click();
    await expect(page.locator(".message-sources code")).toHaveText("fixture-blob-1");
    await page.reload();
    await expect(page.locator(".chat-message.assistant")).toContainText("I prefer short appointment summaries.");
    await expect(page.locator(".chat-message").first()).toHaveClass(/user/);
    await page.screenshot({ path: "test-results/test-fixture-chat-recall.png", fullPage: true });
  });
});
