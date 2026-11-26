import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", permissions: ["clipboard-read", "clipboard-write"] },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: { command: `npm run dev -- -p ${PORT}`, url: `http://localhost:${PORT}/dashboard`, reuseExistingServer: true, timeout: 120_000 },
});
