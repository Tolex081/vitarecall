// Captures an EXISTING receipt and performs read-only live recall. No blob writes.
import { chromium } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../server/config.js";

const config = loadConfig();
const login = JSON.parse(readFileSync(path.join(config.dataDir, "mainnet-demo-login.json"), "utf8"));
const proof = JSON.parse(readFileSync(path.join(config.dataDir, "mainnet-proof.json"), "utf8"));
if (!proof.blobId || proof.status !== "stored") throw new Error("A confirmed mainnet receipt is required.");
const systemChrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const browser = await chromium.launch({ headless: true, channel: "chrome", ...(process.platform === "win32" && existsSync(systemChrome) ? { executablePath: systemChrome } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  await page.goto(config.appOrigin, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Email account", exact: true }).click();
  await page.getByLabel("Email address", { exact: true }).fill(login.email);
  await page.getByLabel("Password", { exact: true }).fill(login.password);
  await page.getByRole("button", { name: "Sign in to VitaRecall", exact: true }).click();
  await page.getByLabel("Message Vita", { exact: true }).waitFor();
  if (await page.locator(".chat-message.assistant .message-sources").count()) {
    await page.locator(".chat-message.assistant .message-sources summary").last().click();
    await page.screenshot({ path: path.join(config.dataDir, "chat-proof.png"), fullPage: true });
  }
  const nav = page.getByRole("navigation", { name: "Primary navigation", exact: true });
  await nav.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Test Walrus connection", exact: true }).click();
  await page.getByText("Walrus authenticated connection verified. No blob was written by this check.", { exact: true }).waitFor({ timeout: 45000 });
  await nav.getByRole("button", { name: /Patient memory/ }).click();
  await page.locator(".receipt-line code").filter({ hasText: proof.blobId }).waitFor();
  await page.getByLabel("Search memories", { exact: true }).fill("What appointment summaries does the fictional demo patient prefer?");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.locator(".recall-results code").filter({ hasText: proof.blobId }).waitFor({ timeout: 60000 });
  const screenshot = path.join(config.dataDir, "mainnet-proof.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await page.getByRole("button", { name: "Sign out", exact: true }).filter({ visible: true }).click();
  console.log(JSON.stringify({ appReceiptVerified: true, liveAppRecallVerified: true, blobId: proof.blobId, screenshot }));
} catch {
  console.error("Receipt screenshot could not be completed. No new blob was submitted; no credentials were printed.");
  process.exitCode = 1;
} finally { await browser.close(); }
