import { defineConfig, devices } from "@playwright/test";

// cmd.exe does not accept forward slashes in a relative executable path
const py = process.platform === "win32" ? ".venv\\Scripts\\python.exe" : ".venv/bin/python";
// Ports can be moved (E2E_WEB_PORT / E2E_API_PORT) so tests never touch an instance that is already in use.
const WEB = Number(process.env.E2E_WEB_PORT ?? 5173);
const API = Number(process.env.E2E_API_PORT ?? 8000);

export default defineConfig({
  testDir: "./e2e",
  timeout: 240_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${WEB}`, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: [
    {
      command: `${py} -m uvicorn aegis.main:app --host 127.0.0.1 --port ${API}`,
      cwd: "../backend",
      url: `http://127.0.0.1:${API}/api/health`,
      reuseExistingServer: true,
      timeout: 120_000,
      env: { AEGIS_DATA_DIR: "../data/e2e", AEGIS_TORCH_DEVICE: "cpu" },
    },
    {
      command: `npx vite --port ${WEB} --strictPort`,
      url: `http://localhost:${WEB}`,
      reuseExistingServer: true,
      timeout: 60_000,
      env: { AEGIS_API_URL: `http://127.0.0.1:${API}` },
    },
  ],
});
