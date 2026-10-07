import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5180',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-webgl', '--enable-unsafe-swiftshader'] },
  },
  webServer: [
    { command: `"${resolve('..', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')}" -m uvicorn app.main:app --app-dir "${resolve('..', 'backend')}" --host 127.0.0.1 --port 8010`, url: 'http://127.0.0.1:8010/api/health', reuseExistingServer: false, timeout: 30_000 },
    { command: 'npm run preview -- --host 127.0.0.1 --port 5180 --strictPort', url: 'http://127.0.0.1:5180', env: { ALLUR_API_TARGET: 'http://127.0.0.1:8010' }, reuseExistingServer: false, timeout: 30_000 },
  ],
})
