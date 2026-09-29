import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const systemChrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

export default defineConfig({
  testDir: "./tests",
  timeout: 30000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3187",
    channel: "chrome",
    launchOptions: process.platform === "win32" && existsSync(systemChrome) ? { executablePath: systemChrome } : {},
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node tests/e2e-server.js",
    url: "http://127.0.0.1:3187/api/health",
    reuseExistingServer: false,
    timeout: 15000,
  },
});
