import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { ARCHIVE_KEY } from '../src/features/opportunities/lib/archive'
import { buildSummaries } from '../src/features/opportunities/lib/candidates'
import {
  type Followup,
  updateFollowups,
} from '../src/features/opportunities/lib/followups'
import { parseQuote } from '../src/features/opportunities/lib/mainnet-read'

function savedExample(now: number) {
  const detectedAt = now - 120000
  const summary = buildSummaries({
    address: `0x${'c'.repeat(40)}`,
    startTime: detectedAt - 10000,
    checkedAt: detectedAt,
    positions: { BTC: '2', ETH: '0', SOL: '0' },
    fills: [
      {
        coin: 'BTC',
        side: 'B',
        time: detectedAt - 1000,
        startPosition: '0',
        sz: '2',
        px: '60000',
        oid: 1,
        tid: 1,
        dir: 'Open Long',
        hash: '0x0',
      },
    ],
  })[0]
  const quote = parseQuote(
    {
      coin: 'BTC',
      time: detectedAt,
      levels: [[{ px: '59999', sz: '1' }], [{ px: '60000', sz: '1' }]],
    },
    detectedAt,
  )
  return JSON.stringify({
    version: 1,
    followups: updateFollowups([], [summary], { BTC: quote }, detectedAt, true),
    cooldownUntil: 0,
  })
}

test('主网观察自动发现、平仓失效、错误降级与暂停均保持只读', async ({
  page,
}) => {
  const startedAt = Date.now()
  const user = `0x${'a'.repeat(40)}`
  const other = `0x${'b'.repeat(40)}`
  let stage = 0
  let fail = false
  let pushQuote: (timestamp?: number, ask?: string, bid?: string) => void =
    () => {}
  const calls: string[] = []
  const writes: string[] = []
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    if (request.url().includes('/exchange')) writes.push(request.url())
  })
  await page.addInitScript(() => {
    Object.defineProperty(window, 'ethereum', {
      get() {
        throw new Error('只读页面不应访问钱包')
      },
    })
  })
  await page.routeWebSocket('wss://api.hyperliquid.xyz/ws', (socket) => {
    pushQuote = (timestamp = startedAt, ask = '65145', bid = '63855') =>
      socket.send(
        JSON.stringify({
          channel: 'l2Book',
          data: {
            coin: 'BTC',
            time: timestamp,
            levels: [
              [{ px: bid, sz: '0.1', n: 1 }],
              [{ px: ask, sz: '0.2', n: 1 }],
            ],
          },
        }),
      )
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw))
      if (message.method === 'ping')
        socket.send(JSON.stringify({ channel: 'pong' }))
      if (message.subscription?.type === 'l2Book')
        expect(message.subscription.fast).toBe(true)
      if (
        message.subscription?.coin === 'BTC' &&
        message.subscription.type === 'l2Book'
      )
        pushQuote()
      if (
        message.subscription?.coin === 'BTC' &&
        message.subscription.type === 'trades'
      )
        socket.send(
          JSON.stringify({
            channel: 'trades',
            data: [
              {
                coin: 'BTC',
                time: startedAt,
                tid: 1,
                px: '64500',
                sz: '8',
                users: [user, other],
              },
            ],
          }),
        )
    })
  })
  await page.route('https://api.hyperliquid.xyz/info', async (route) => {
    const body = route.request().postDataJSON()
    calls.push(body.type)
    if (fail) {
      await route.fulfill({ status: 503, body: '{}' })
      return
    }
    const checkedAt = startedAt + stage * 31_000
    const opening = {
      coin: 'BTC',
      time: startedAt,
      side: 'B',
      px: '64500',
      sz: '8',
      startPosition: '0',
      dir: 'Open Long',
      oid: 1,
      tid: 1,
      hash: `0x${'1'.repeat(64)}`,
    }
    const closing = {
      ...opening,
      time: startedAt + 20_000,
      side: 'A',
      startPosition: '10',
      sz: '10',
      dir: 'Close Long',
      oid: 2,
      tid: 2,
    }
    const adding = { ...opening, startPosition: '8', sz: '2', oid: 3, tid: 3 }
    const data =
      body.type === 'clearinghouseState'
        ? {
            time: checkedAt,
            assetPositions:
              body.user === user && stage === 0
                ? [{ position: { coin: 'BTC', szi: '10' } }]
                : [],
          }
        : body.type === 'userFillsByTime' && body.user === user
          ? stage === 0
            ? [opening, adding]
            : [opening, adding, closing]
          : []
    await route.fulfill({ json: data })
  })
  await page.goto('/opportunities')
  await expect(page.getByText('已连接', { exact: true })).toBeVisible()
  await page.clock.install({ time: startedAt })
  await page.clock.runFor(2000)
  const summary = page.getByRole('article', { name: 'BTC 多头持仓摘要' })
  await expect(summary).toHaveCount(1)
  await expect(summary.getByText('候选', { exact: true })).toBeVisible()
  await expect(summary).toContainText('本段合并 2 个订单、2 笔成交')
  const priceReference = summary.getByRole('region', {
    name: 'BTC 入场价格参考',
  })
  await expect(
    priceReference.getByText('64,500 USDC', { exact: true }),
  ).toBeVisible()
  await expect(
    priceReference.getByText('65,145 USDC', { exact: true }),
  ).toBeVisible()
  await expect(
    priceReference.getByText('+1.000%', { exact: true }),
  ).toBeVisible()
  await expect(
    priceReference.getByText('0.2 BTC', { exact: true }),
  ).toBeVisible()
  await page.clock.fastForward(11_000)
  await expect(
    priceReference.getByText('盘口超过 10 秒未更新或时间异常'),
  ).toBeVisible()
  await expect(
    priceReference.getByText('65,145 USDC', { exact: true }),
  ).toHaveCount(0)
  const expiredDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出证据' }).click()
  const expiredPath = await (await expiredDownload).path()
  if (!expiredPath) throw new Error('过期报价证据未生成')
  const expired = JSON.parse(await readFile(expiredPath, 'utf8'))
  expect(expired.reports[0].summaries[0].assessment.eligible).toBe(true)
  expect(expired.reports[0].summaries[0].entry).toEqual({
    available: false,
    reason: '盘口超过 10 秒未更新或时间异常',
  })
  const quoteTime = await page.evaluate(() => Date.now())
  pushQuote(quoteTime)
  await page.clock.runFor(1000)
  await expect(
    priceReference.getByText('65,145 USDC', { exact: true }),
  ).toBeVisible()
  pushQuote(quoteTime - 1000, '99999')
  await page.clock.runFor(1000)
  await expect(
    priceReference.getByText('65,145 USDC', { exact: true }),
  ).toBeVisible()
  await page.screenshot({
    path: 'output-tdd/playwright/opportunity-stability/price-reference.png',
    fullPage: true,
  })
  await page.getByRole('button', { name: /性能 ·/ }).click()
  const metricsDialog = page.getByRole('dialog', { name: '性能监测' })
  await expect(metricsDialog.getByRole('table')).toContainText('机会行情采样')
  await expect(metricsDialog.getByRole('row')).toHaveCount(4)
  const metricsDownload = page.waitForEvent('download')
  await metricsDialog
    .getByRole('button', { name: '导出指标', exact: true })
    .click()
  const metricsPath = await (await metricsDownload).path()
  if (!metricsPath) throw new Error('性能指标未导出')
  const metrics = JSON.parse(await readFile(metricsPath, 'utf8'))
  for (const id of [
    'opportunityStream',
    'opportunityScan',
    'opportunityReact',
  ]) {
    expect(
      metrics.modules.find((row: { id: string }) => row.id === id).totalUpdates,
    ).toBeGreaterThan(0)
  }
  expect(
    metrics.modules.find(
      (row: { id: string }) => row.id === 'opportunityStream',
    ).totalInput,
  ).toBeGreaterThan(0)
  expect(JSON.stringify(metrics)).not.toContain(user)
  await page.screenshot({
    path: 'output-tdd/playwright/opportunity-stability/performance.png',
    fullPage: true,
  })
  await metricsDialog.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '订单活动', exact: true }).click()
  const openingCard = page.getByRole('article', { name: 'BTC 新开多仓' })
  await expect(openingCard.getByText('仍持有', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '连接钱包' })).toHaveCount(0)
  await openingCard.getByText('查看成交证据').click()
  await expect(
    openingCard.getByRole('link', { name: '交易记录' }),
  ).toHaveAttribute('href', /^https:\/\/app\.hyperliquid\.xyz\/explorer\/tx\//)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出证据' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^mainnet-observations-/)
  const path = await file.path()
  if (!path) throw new Error('导出证据未生成')
  const exported = JSON.parse(await readFile(path, 'utf8'))
  const exportedSummary = exported.reports.flatMap(
    (report: { summaries: unknown[] }) => report.summaries,
  )
  expect(exportedSummary).toHaveLength(1)
  expect(exportedSummary[0].assessment.eligible).toBe(true)
  expect(exportedSummary[0].assessment.averageEntryPrice).toBe('64500')
  expect(exportedSummary[0].entry.available).toBe(true)
  expect(exportedSummary[0].entry.adversePercent).toBe('1')
  expect(exported.quotes.BTC.ask.px).toBe('65145')
  expect(exported.followups).toHaveLength(1)
  expect(exported.followups[0].entry.price).toBe('65145')
  stage = 1
  await page.clock.fastForward(31_000)
  await expect(openingCard.getByText('已退出', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('article', { name: 'BTC 平仓多仓' }),
  ).toBeVisible()
  await page.getByRole('button', { name: '候选机会', exact: true }).click()
  await expect(page.getByRole('article')).toHaveCount(0)
  await expect(
    page.getByText('暂时没有符合规则的候选', { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: '全部摘要', exact: true }).click()
  await expect(summary.getByText('已退出', { exact: true })).toBeVisible()
  const target = exported.followups[0].points[0].dueAt
  await page.clock.fastForward(
    target - (await page.evaluate(() => Date.now())) + 1000,
  )
  pushQuote(await page.evaluate(() => Date.now()), '65800', '65796.45')
  await page.clock.runFor(1000)
  await page.getByRole('button', { name: '后续表现', exact: true }).click()
  const followupTable = page.getByRole('table', { name: '候选后续表现记录' })
  await expect(
    followupTable.getByText('+1.000%', { exact: true }),
  ).toBeVisible()
  await expect(followupTable.getByRole('row')).toHaveCount(2)
  await expect(
    page.getByRole('region', { name: '1 分钟统计', exact: true }),
  ).toContainText('有效 1 / 总计 1')
  await page.screenshot({
    path: 'output-tdd/playwright/opportunity-stability/followups.png',
    fullPage: true,
  })
  await page.getByRole('button', { name: '订单活动', exact: true }).click()
  fail = true
  await page.clock.fastForward(31_000)
  await expect(openingCard.getByText('待核验', { exact: true })).toBeVisible()
  await expect(page.getByText('2 个账户暂未通过核验')).toBeVisible()
  await page.getByRole('button', { name: '全部摘要', exact: true }).click()
  await expect(summary.getByText('待核验', { exact: true })).toBeVisible()
  const staleDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出证据' }).click()
  const stalePath = await (await staleDownload).path()
  if (!stalePath) throw new Error('待核验证据未生成')
  const stale = JSON.parse(await readFile(stalePath, 'utf8'))
  expect(stale.reports[0].summaries[0].assessment.status).toBe('待核验')
  expect(stale.reports[0].summaries[0].assessment.eligible).toBe(false)
  expect(stale.reports[0].summaries[0].entry.available).toBe(false)
  await page.getByRole('button', { name: '暂停观察' }).click()
  const count = calls.length
  await page.clock.fastForward(120_000)
  expect(calls.length).toBe(count)
  await page.clock.fastForward(15 * 60_000)
  await page.getByRole('button', { name: '后续表现', exact: true }).click()
  await expect(followupTable.getByText('缺测', { exact: true })).toHaveCount(2)
  await expect(
    followupTable.getByText('+1.000%', { exact: true }),
  ).toBeVisible()
  const followupDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出证据' }).click()
  const followupPath = await (await followupDownload).path()
  if (!followupPath) throw new Error('后续表现未导出')
  const followupEvidence = JSON.parse(await readFile(followupPath, 'utf8'))
  expect(
    followupEvidence.followups[0].points.map(
      (point: { status: string }) => point.status,
    ),
  ).toEqual(['measured', 'missing', 'missing'])
  expect(followupEvidence.followupStats[0].averagePercent).toBe('1')
  expect(followupEvidence.followupStats[1].missing).toBe(1)
  expect(calls.length).toBe(count)
  await page.setViewportSize({ width: 375, height: 900 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.screenshot({
    path: 'output-tdd/playwright/opportunity-stability/mobile-paused.png',
    fullPage: true,
  })
  await page.getByRole('button', { name: '重新扫描', exact: true }).click()
  await expect(followupTable.getByRole('row')).toHaveCount(2)
  expect(writes).toEqual([])
  expect(errors).toEqual([])
  expect(
    calls.every((type) =>
      [
        'clearinghouseState',
        'userFillsByTime',
        'userTwapSliceFillsByTime',
      ].includes(type),
    ),
  ).toBe(true)
})

test('真实主网只读扫描与仓位核验 @live', async ({ page }) => {
  test.skip(process.env.LIVE_CHECK !== '1', '仅显式运行主网只读验收')
  test.setTimeout(150000)
  const writes: string[] = []
  const reads: {
    type: string
    user: string
    status: number
    startTime?: number
    endTime?: number
  }[] = []
  const errors: string[] = []
  const freshBooks = new Set<string>()
  page.on('websocket', (socket) => {
    socket.on('framereceived', ({ payload }) => {
      const message = JSON.parse(String(payload))
      if (
        message.channel === 'l2Book' &&
        Math.abs(Date.now() - message.data.time) <= 10000
      )
        freshBooks.add(message.data.coin)
    })
  })
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    if (request.url().includes('/exchange')) writes.push(request.url())
  })
  page.on('response', (response) => {
    if (response.url() === 'https://api.hyperliquid.xyz/info')
      reads.push({
        type: response.request().postDataJSON().type,
        user: response.request().postDataJSON().user,
        status: response.status(),
        startTime: response.request().postDataJSON().startTime,
        endTime: response.request().postDataJSON().endTime,
      })
  })
  await page.goto('/opportunities')
  await expect(page.getByText('已连接', { exact: true })).toBeVisible({
    timeout: 30000,
  })
  await page.getByRole('button', { name: '全部摘要', exact: true }).click()
  await expect(page.getByRole('article').first()).toBeVisible({
    timeout: 90000,
  })
  const firstAccount = reads.find(
    (row) => row.type === 'userTwapSliceFillsByTime',
  )?.user
  expect(firstAccount).toBeTruthy()
  await expect
    .poll(
      () =>
        reads.filter(
          (row) =>
            row.user === firstAccount &&
            row.type === 'userTwapSliceFillsByTime' &&
            row.status === 200,
        ).length,
      { timeout: 90000 },
    )
    .toBeGreaterThanOrEqual(2)
  await page.screenshot({
    path: 'output-tdd/playwright/opportunity-stability/mainnet-desktop.png',
    fullPage: true,
  })
  await page.getByRole('article').first().getByText('查看成交证据').click()
  await page.setViewportSize({ width: 375, height: 900 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.screenshot({
    path: 'output-tdd/playwright/opportunity-stability/mainnet-mobile.png',
    fullPage: true,
  })
  const capture = async () => {
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: '导出证据' }).click()
    const evidencePath =
      'output-tdd/playwright/opportunity-stability/mainnet-evidence.json'
    await (await download).saveAs(evidencePath)
    return JSON.parse(await readFile(evidencePath, 'utf8'))
  }
  let evidence = await capture()
  const pending = evidence.followups.find(
    (record: Followup) => record.points[0].status === 'pending',
  ) as Followup | undefined
  if (pending) {
    const deadline = pending.points[0].dueAt + 11000
    while (Date.now() < deadline)
      await page.waitForTimeout(Math.min(30000, deadline - Date.now()))
    evidence = await capture()
    expect(
      evidence.followups.find((record: Followup) => record.id === pending.id)
        .points[0].status,
    ).not.toBe('pending')
  }
  expect([...freshBooks].sort()).toEqual(['BTC', 'ETH', 'SOL'])
  expect(
    reads.some(
      (row, index) =>
        row.type === 'userFillsByTime' &&
        row.status === 200 &&
        reads
          .slice(0, index)
          .some(
            (previous) =>
              previous.type === row.type &&
              previous.user === row.user &&
              previous.status === 200 &&
              row.startTime === previous.endTime,
          ),
    ),
  ).toBe(true)
  expect(Object.keys(evidence.quotes).sort()).toEqual(['BTC', 'ETH', 'SOL'])
  for (const quote of Object.values(evidence.quotes) as {
    bid: { px: string }
    ask: { px: string }
  }[]) {
    expect(Number(quote.ask.px)).toBeGreaterThan(Number(quote.bid.px))
  }
  for (const report of evidence.reports) {
    for (const summary of report.summaries) {
      const quote = evidence.quotes[summary.coin]
      if (
        evidence.exportedAt - quote.time > 10000 ||
        evidence.exportedAt - quote.receivedAt > 10000
      )
        expect(summary.entry.available).toBe(false)
      if (summary.entry.available) {
        expect(evidence.exportedAt - quote.time).toBeLessThanOrEqual(10000)
        expect(quote.time).toBeGreaterThanOrEqual(summary.lastTime)
        expect(summary.entry.price).toBe(
          quote[summary.side === 'long' ? 'ask' : 'bid'].px,
        )
      }
    }
  }
  for (const record of evidence.followups as Followup[]) {
    for (const point of record.points) {
      if (point.status !== 'measured') continue
      expect(point.quote.time).toBeGreaterThanOrEqual(point.dueAt)
      expect(point.quote.receivedAt).toBeGreaterThanOrEqual(point.dueAt)
      expect(point.sampledAt - point.dueAt).toBeLessThanOrEqual(10000)
    }
  }
  await page.getByRole('button', { name: '后续表现', exact: true }).click()
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.screenshot({
    path: 'output-tdd/playwright/opportunity-stability/mainnet-followups.png',
    fullPage: true,
  })
  await page.getByRole('button', { name: /性能 ·/ }).click()
  const metricsDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出指标', exact: true }).click()
  const metricsPath =
    'output-tdd/playwright/opportunity-stability/mainnet-performance.json'
  await (await metricsDownload).saveAs(metricsPath)
  const metrics = JSON.parse(await readFile(metricsPath, 'utf8'))
  expect(
    metrics.modules.find(
      (row: { id: string }) => row.id === 'opportunityStream',
    ).totalInput,
  ).toBeGreaterThan(0)
  await page.screenshot({
    path: 'output-tdd/playwright/opportunity-stability/mainnet-performance.png',
    fullPage: true,
  })
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '关闭', exact: true })
    .click()
  await page.getByRole('button', { name: '暂停观察' }).click()
  expect(writes).toEqual([])
  expect(errors).toEqual([])
  expect(
    reads.some(
      (row) => row.type === 'userTwapSliceFillsByTime' && row.status === 200,
    ),
  ).toBe(true)
})

test('本机存档在刷新后恢复，多标签页只采集一次并在关闭后交接', async ({
  page,
  context,
}) => {
  let sockets = 0
  await context.routeWebSocket('wss://api.hyperliquid.xyz/ws', () => {
    sockets++
  })
  await page.addInitScript(
    ({ key, raw }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, raw)
    },
    { key: ARCHIVE_KEY, raw: savedExample(Date.now()) },
  )
  await page.goto('/opportunities')
  await expect(page.getByText('已连接', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '后续表现', exact: true }).click()
  const table = page.getByRole('table', { name: '候选后续表现记录' })
  await expect(table.getByText('缺测', { exact: true })).toHaveCount(1)
  const other = await context.newPage()
  await other.goto('/opportunities')
  await expect(other.getByText(/等待读写权限/)).toBeVisible()
  await expect(other.getByRole('button', { name: '暂停观察' })).toBeDisabled()
  expect(sockets).toBe(1)
  await page.close()
  await expect(other.getByText('已连接', { exact: true })).toBeVisible()
  expect(sockets).toBe(2)
  await other.reload()
  await expect(other.getByText('已连接', { exact: true })).toBeVisible()
  await other.getByRole('button', { name: '后续表现', exact: true }).click()
  await expect(
    other.getByRole('table').getByText('缺测', { exact: true }),
  ).toHaveCount(1)
  const download = other.waitForEvent('download')
  await other.getByRole('button', { name: '导出证据' }).click()
  const path = await (await download).path()
  if (!path) throw new Error('存档导出失败')
  const data = JSON.parse(await readFile(path, 'utf8'))
  expect(data.followups).toHaveLength(1)
  expect(data.followups[0].entry.price).toBe('60000')
  expect(data.quotes).toEqual({})
  expect(data.reports).toEqual([])
  await other.close()
})

test('损坏存档不会被空数据覆盖，确认清空前保持原文', async ({ page }) => {
  let sockets = 0
  await page.routeWebSocket('wss://api.hyperliquid.xyz/ws', () => {
    sockets++
  })
  await page.addInitScript(
    (key) => localStorage.setItem(key, '{broken'),
    ARCHIVE_KEY,
  )
  await page.goto('/opportunities')
  await expect(page.getByText(/本机存档无效/)).toBeVisible()
  expect(sockets).toBe(0)
  expect(
    await page.evaluate((key) => localStorage.getItem(key), ARCHIVE_KEY),
  ).toBe('{broken')
  await page.getByRole('button', { name: '后续表现', exact: true }).click()
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.getByRole('button', { name: '清空本机记录' }).click()
  expect(
    await page.evaluate((key) => localStorage.getItem(key), ARCHIVE_KEY),
  ).toBe('{broken')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '清空本机记录' }).click()
  await expect(page.getByText('已连接', { exact: true })).toBeVisible()
  expect(
    JSON.parse(
      (await page.evaluate((key) => localStorage.getItem(key), ARCHIVE_KEY)) ??
        'null',
    ).followups,
  ).toEqual([])
})

test('存储空间不足显示未保存，重试成功后保留本页最新记录', async ({ page }) => {
  await page.routeWebSocket('wss://api.hyperliquid.xyz/ws', () => {})
  const raw = savedExample(Date.now())
  await page.addInitScript(
    ({ key, raw }) => {
      localStorage.setItem(key, raw)
      const original = Storage.prototype.setItem
      let blocked = true
      window.addEventListener('allow-test-storage', () => {
        blocked = false
      })
      Storage.prototype.setItem = function (k, v) {
        if (k === key && blocked)
          throw new DOMException('full', 'QuotaExceededError')
        return original.call(this, k, v)
      }
    },
    { key: ARCHIVE_KEY, raw },
  )
  await page.goto('/opportunities')
  await expect(page.getByText(/自动保存失败/)).toBeVisible()
  expect(
    await page.evaluate((key) => localStorage.getItem(key), ARCHIVE_KEY),
  ).toBe(raw)
  await page.evaluate(() =>
    window.dispatchEvent(new Event('allow-test-storage')),
  )
  await page.getByRole('button', { name: '重试保存' }).click()
  await expect(page.getByText(/自动保存失败/)).toHaveCount(0)
  const stored = JSON.parse(
    (await page.evaluate((key) => localStorage.getItem(key), ARCHIVE_KEY)) ??
      'null',
  )
  expect(stored.followups[0].points[0].status).toBe('missing')
})

test('429 暂停整轮账户请求，重新扫描和刷新不能绕过冷却', async ({ page }) => {
  const startedAt = Date.now()
  const user = `0x${'a'.repeat(40)}`,
    other = `0x${'b'.repeat(40)}`
  let calls = 0
  await page.clock.install({ time: startedAt })
  await page.routeWebSocket('wss://api.hyperliquid.xyz/ws', (socket) => {
    socket.onMessage((raw) => {
      const msg = JSON.parse(String(raw))
      if (msg.method === 'ping')
        socket.send(JSON.stringify({ channel: 'pong' }))
      if (
        msg.subscription?.type === 'trades' &&
        msg.subscription.coin === 'BTC'
      )
        socket.send(
          JSON.stringify({
            channel: 'trades',
            data: [
              {
                coin: 'BTC',
                time: startedAt,
                tid: 1,
                px: '60000',
                sz: '2',
                users: [user, other],
              },
            ],
          }),
        )
    })
  })
  await page.route('https://api.hyperliquid.xyz/info', async (route) => {
    calls++
    if (calls === 1)
      return route.fulfill({
        status: 429,
        headers: { 'Retry-After': '120' },
        body: '{}',
      })
    const type = route.request().postDataJSON().type
    await route.fulfill({
      json:
        type === 'clearinghouseState'
          ? { time: await page.evaluate(() => Date.now()), assetPositions: [] }
          : [],
    })
  })
  await page.goto('/opportunities')
  await expect(page.getByText('已连接', { exact: true })).toBeVisible()
  await page.clock.runFor(2000)
  await expect(page.getByText(/账户查询冷却中/)).toBeVisible()
  expect(calls).toBe(1)
  const until = JSON.parse(
    (await page.evaluate((key) => localStorage.getItem(key), ARCHIVE_KEY)) ??
      'null',
  ).cooldownUntil
  await page.getByRole('button', { name: '重新扫描', exact: true }).click()
  await page.clock.runFor(3000)
  expect(calls).toBe(1)
  await page.reload()
  await expect(page.getByText('已连接', { exact: true })).toBeVisible()
  await page.clock.runFor(3000)
  expect(calls).toBe(1)
  await page.clock.fastForward(
    until - (await page.evaluate(() => Date.now())) + 1000,
  )
  await expect.poll(() => calls).toBeGreaterThan(1)
})
