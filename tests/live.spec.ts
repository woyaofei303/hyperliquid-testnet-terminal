import { expect, test } from '@playwright/test'

test('真实测试网双图表、分层成交量及 fameex-testnet 布局 @live', async ({
  page,
}) => {
  test.setTimeout(120000)
  const errors: string[] = []
  const writes: string[] = []
  const sockets: string[] = []
  let navigations = 0
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('websocket', (ws) => {
    if (ws.url().includes('hyperliquid')) sockets.push(ws.url())
  })
  page.on('request', (request) => {
    if (request.url().endsWith('/exchange')) writes.push(request.url())
    if (request.isNavigationRequest() && request.frame() === page.mainFrame())
      navigations++
  })
  const screenshots = 'output-tdd/playwright/kline-tools/live'
  await page.setViewportSize({ width: 1440, height: 1080 })
  await page.goto('/')
  await expect(
    page.getByRole('region', { name: /基础版 K 线图，已加载 [1-9]\d* 根/ }),
  ).toBeVisible({ timeout: 30000 })
  await expect(page.getByText('实时连接', { exact: false })).toBeVisible({
    timeout: 30000,
  })
  await page.screenshot({
    animations: 'disabled',
    path: `${screenshots}/desktop-1440.png`,
    fullPage: true,
  })
  await page.setViewportSize({ width: 2560, height: 1300 })
  const book = page.getByRole('region', { name: '订单簿', exact: true })
  await expect
    .poll(() => book.locator('[data-side="sell"] > button').count())
    .toBeGreaterThan(9)
  await page.screenshot({
    animations: 'disabled',
    path: `${screenshots}/depth-2560.png`,
    fullPage: true,
  })
  await page.getByRole('tab', { name: '最新成交', exact: true }).click()
  await expect(
    page
      .getByRole('table', { name: 'BTC 最新成交' })
      .locator('tbody tr')
      .first(),
  ).toBeVisible({ timeout: 30000 })
  const tradeLink = book
    .getByRole('link', { name: /查看成交.*链上交易/ })
    .first()
  await expect(tradeLink).toHaveAttribute(
    'href',
    /^https:\/\/app\.hyperliquid-testnet\.xyz\/explorer\/tx\/0x[0-9a-fA-F]{64}$/,
  )
  await expect(tradeLink).toHaveAttribute('target', '_blank')
  await page.screenshot({
    animations: 'disabled',
    path: `${screenshots}/trades-2560.png`,
    fullPage: true,
  })
  await page.getByRole('tab', { name: '订单簿', exact: true }).click()
  await book.locator('[data-side="sell"] [data-price]').last().hover()
  await expect(page.getByRole('tooltip', { name: '档位详情' })).toBeVisible()
  await page.screenshot({ path: `${screenshots}/hover-2560.png` })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight + 1,
    ),
  ).toBe(true)
  await page.setViewportSize({ width: 1440, height: 1080 })
  await page.getByRole('button', { name: 'TradingView', exact: true }).click()
  const frame = page.frameLocator('iframe')
  await expect(frame.locator('body')).toContainText(/开=\d/, { timeout: 30000 })
  const panes = await frame.locator('canvas').evaluateAll((els) => {
    const rows = els
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 200 && r.height > 60)
    return [
      ...new Map(rows.map((r) => [r.y, { y: r.y, height: r.height }])).values(),
    ].sort((a, b) => a.y - b.y)
  })
  expect(panes).toHaveLength(2)
  expect(panes[1].y).toBeGreaterThanOrEqual(panes[0].y + panes[0].height)
  expect(panes[1].height / (panes[0].height + panes[1].height)).toBeCloseTo(
    0.25,
    1,
  )
  await page.screenshot({
    animations: 'disabled',
    path: `${screenshots}/tradingview-1440.png`,
    fullPage: true,
  })
  await page.setViewportSize({ width: 375, height: 900 })
  await page.screenshot({
    animations: 'disabled',
    path: `${screenshots}/tradingview-375.png`,
    fullPage: true,
  })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.setViewportSize({ width: 1440, height: 1080 })
  await page.getByRole('button', { name: '交易市场' }).click()
  await page.getByRole('option', { name: 'ETH / USDC', exact: true }).click()
  await page.getByRole('button', { name: '1分', exact: true }).click()
  await expect(frame.locator('body')).toContainText('ETH / USDC 永续', {
    timeout: 30000,
  })
  await expect(frame.locator('body')).toContainText(/开=\d/, { timeout: 30000 })
  await page.getByRole('button', { name: '基础版', exact: true }).click()
  await expect(
    page.getByRole('region', { name: /基础版 K 线图，已加载 [1-9]\d* 根/ }),
  ).toBeVisible({ timeout: 30000 })
  for (const width of [375, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    for (const name of ['行情图表', '订单簿', '下单面板']) {
      const box = await page
        .getByRole('region', { name, exact: true })
        .boundingBox()
      expect(box && box.width > 100 && box.x + box.width <= width).toBeTruthy()
    }
    await expect
      .poll(async () => {
        const selected = await page
          .getByRole('tab', { name: '买入 / 做多', exact: true })
          .boundingBox()
        const cursor = await page
          .getByRole('tablist', { name: '交易方向' })
          .locator('[data-slot="cursor"]')
          .boundingBox()
        return selected && cursor
          ? Math.abs(selected.width - cursor.width)
          : Infinity
      })
      .toBeLessThan(2)
    await page.screenshot({
      animations: 'disabled',
      path: `${screenshots}/viewport-${width}.png`,
      fullPage: true,
    })
  }
  await page.getByRole('button', { name: '调整杠杆', exact: true }).click()
  await expect(page.getByLabel('杠杆倍数')).toBeVisible()
  await expect(
    page.getByRole('button', { name: '应用杠杆设置' }),
  ).toBeDisabled()
  await page.screenshot({
    animations: 'disabled',
    path: `${screenshots}/leverage-readonly.png`,
    fullPage: true,
  })
  expect(navigations).toBe(1)
  // useMarket 分别连接快速盘口与完整行情；切币和切引擎均复用这两条连接。
  expect(sockets).toHaveLength(2)
  expect(errors).toEqual([])
  expect(writes).toEqual([])
})
