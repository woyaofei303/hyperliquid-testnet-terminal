import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.SMOKE_BASE_URL
const url = new URL(baseURL || 'invalid:')
if (
  ![
    'https://app.fameex-testnet.xyz',
    'https://staging-app.fameex-testnet.xyz',
  ].includes(url.origin) &&
  !(
    url.protocol === 'http:' &&
    ['127.0.0.1', 'localhost'].includes(url.hostname)
  )
)
  throw new Error('SMOKE_BASE_URL 必须是已知部署站点或本机测试端口')
if (!/^[0-9a-f]{40}-\d+-\d+$/.test(process.env.EXPECTED_RELEASE_ID || ''))
  throw new Error('必须提供 EXPECTED_RELEASE_ID')
if (!['true', 'false'].includes(process.env.EXPECT_PHONE_PAIRING || ''))
  throw new Error('必须提供 EXPECT_PHONE_PAIRING=true|false')

export default defineConfig({
  testDir: './tests',
  testMatch: 'deploy-smoke.spec.ts',
  retries: 0,
  workers: 1,
  timeout: 90000,
  reporter: [['list']],
  outputDir: 'output-tdd/playwright/deployment-smoke',
  use: {
    ...devices['Desktop Chrome'],
    channel: 'chrome',
    baseURL,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
