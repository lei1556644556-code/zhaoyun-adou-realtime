import path from "node:path";
import { defineConfig } from "@playwright/test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const externalBaseURL = process.env.QA_BASE_URL?.trim();
const baseURL = externalBaseURL || "http://127.0.0.1:5173";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [["list"], ["html", { outputFolder: path.join(repositoryRoot, "playwright-report"), open: "never" }]],
  outputDir: path.join(repositoryRoot, "test-results", "qa"),
  use: {
    baseURL,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { browserName: "chromium", viewport: { width: 1440, height: 1100 } } },
    { name: "mobile-390x844", use: { browserName: "chromium", viewport: { width: 390, height: 844 } } },
  ],
  webServer: externalBaseURL ? undefined : {
    command: "pnpm --filter @adou/client dev",
    cwd: repositoryRoot,
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
