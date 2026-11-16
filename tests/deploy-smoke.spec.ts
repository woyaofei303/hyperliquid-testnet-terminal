import { createHash } from 'node:crypto'
import { expect, test } from '@playwright/test'

test('部署版本、配置、资源和只读行情可用', async ({ page, request }) => {
  const expected = process.env.EXPECTED_RELEASE_ID
  const version = await request.get('/version.txt')
  expect(version.status()).toBe(200)
  expect((await version.text()).trim()).toBe(expected)
  expect(version.headers()['cache-control']).toContain('no-store')
  const config = await request.get('/runtime-config.json')
  expect(config.status()).toBe(200)
  expect(config.headers()['cache-control']).toContain('no-store')
  expect(await config.json()).toEqual({
    schemaVersion: 1,
    phonePairingEnabled: process.env.EXPECT_PHONE_PAIRING === 'true',
  })
  const manifestResponse = await request.get('/release-manifest.json')
  expect(manifestResponse.status()).toBe(200)
  const manifest = await manifestResponse.json()
  expect(manifest.releaseId).toBe(expected)
  const asset = Object.keys(manifest.files).find((name) =>
    /^_next\/static\/[\w./-]+\.js$/.test(name),
  )
  expect(asset).toBeTruthy()
  for (const name of ['index.html', asset as string]) {
    const response = await request.get(`/${name}`)
    expect(response.status()).toBe(200)
    expect(
      createHash('sha256')
        .update(await response.body())
        .digest('hex'),
    ).toBe(manifest.files[name])
  }
  expect((await request.get('/deployment-smoke-nonexistent')).status()).toBe(
    404,
  )
  const blocked: string[] = []
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/*', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const read =
      ['GET', 'HEAD'].includes(req.method()) ||
      (req.method() === 'POST' &&
        url.origin === 'https://api.hyperliquid-testnet.xyz' &&
        url.pathname === '/info')
    if (!read || url.pathname === '/exchange') {
      blocked.push(`${req.method()} ${url.origin}${url.pathname}`)
      await route.abort()
    } else await route.continue()
  })
  await page.goto('/')
  for (const name of ['行情图表', '订单簿', '下单面板'])
    await expect(page.getByRole('region', { name, exact: true })).toBeVisible()
  await expect(
    page.getByRole('region', { name: /基础版 K 线图，已加载 [1-9]\d* 根/ }),
  ).toBeVisible({ timeout: 45000 })
  expect(blocked).toEqual([])
  expect(errors).toEqual([])
})
