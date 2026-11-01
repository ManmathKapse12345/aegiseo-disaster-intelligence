import { defineConfig, devices } from "@playwright/test";

// cmd.exe does not accept forward slashes in a relative executable path
const py = process.platform === "win32" ? ".venv\\Scripts\\python.exe" : ".venv/bin/python";

export default defineConfig({
  testDir: "./e2e",
  timeout: 240_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:5173", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: [
    {
      command: `${py} -m uvicorn aegis.main:app --host 127.0.0.1 --port 8000`,
      cwd: "../backend",
      url: "http://127.0.0.1:8000/api/health",
      reuseExistingServer: true,
      timeout: 120_000,
      env: { AEGIS_DATA_DIR: "../data/e2e", AEGIS_TORCH_DEVICE: "cpu" },
    },
    { command: "npx vite --port 5173 --strictPort", url: "http://localhost:5173", reuseExistingServer: true, timeout: 60_000 },
  ],
});
