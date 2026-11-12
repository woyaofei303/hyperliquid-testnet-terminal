import { defineConfig, devices } from '@playwright/test'

const staticExport = process.env.STATIC_EXPORT === '1'
const baseURL = `http://127.0.0.1:${staticExport ? 33211 : 3210}`

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: 0,
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile: `output-tdd/playwright/fameex-testnet/${process.env.LIVE_CHECK ? 'live-results' : 'results'}.json`,
      },
    ],
  ],
  outputDir: 'output-tdd/playwright/fameex-testnet/test-results',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    channel: 'chrome',
  },
  webServer: {
    command: staticExport ? 'python3 scripts/serve-static.py' : 'npm run dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
})
