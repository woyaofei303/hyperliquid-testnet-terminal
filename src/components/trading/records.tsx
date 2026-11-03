'use client'

import { Button, FlatSelect, Tab, Tabs } from '@fameex/ui'
import Image from 'next/image'
import { useEffect, useState } from 'react'
import type { TerminalModel } from '@/hooks/use-terminal'
import { t, useLocale } from '@/i18n'
import { display } from '@/lib/display'
import { isCash, marketLabel, pricePrecision } from '@/lib/market-catalog'
import { Money } from '@/lib/orders'
import type { PositionActionKind } from '@/lib/position-actions'
import { tradePreferences } from '@/lib/trade-preferences'
import { HelpLabel } from './help-label'
import { IsolatedMargin } from './isolated-margin'
import { PositionClose } from './position-close'
import { PositionProtection } from './position-protection'
export function TradingRecords({ model }: { model: TerminalModel }) {
  useLocale()

  const {
    account,
    journal,
    address,
    canTrade,
    tradingReady,
    busy,
    previewCancel,
  } = model
  const cash = isCash(model.market)
  const labelFor = (coin: string) => {
    const market = model.markets.find((m) => m.name === coin)
    return market ? marketLabel(market) : coin
  }
  const [tab, setTab] = useState('positions')
  const [direction, setDirection] = useState('all')
  const [coinFilter, setCoinFilter] = useState('all')
  const directional = tab !== 'journal' && !(tab === 'positions' && cash)
  const matches = (coin: string, side?: string) =>
    (coinFilter === 'all' || coin === coinFilter) &&
    (!directional || direction === 'all' || side === direction)
  const positions = (account.snapshot?.state.assetPositions ?? []).filter(
    ({ position: p }) =>
      new Money(p.szi).abs().gt(0) &&
      matches(p.coin, new Money(p.szi).gt(0) ? 'B' : 'A'),
  )
  const balances = (account.snapshot?.spot.balances ?? []).filter(
    (b) => (Number(b.total) !== 0 || Number(b.hold) !== 0) && matches(b.coin),
  )
  const orders = (account.snapshot?.orders ?? []).filter((row) =>
    matches(row.coin, row.side),
  )
  const fills = (account.snapshot?.fills ?? []).filter((row) =>
    matches(row.coin, row.side),
  )
  const twaps = (account.snapshot?.twaps ?? []).filter((row) =>
    matches(row.state.coin, row.state.side),
  )
  const chases = model.chase.rows.filter((row) =>
    matches(row.ticket.market.name, row.ticket.order.b ? 'B' : 'A'),
  )
  const entries = journal.filter((row) => matches(row.coin))
  const coins = [
    ...new Set([
      ...(coinFilter !== 'all' ? [coinFilter] : []),
      ...(tab === 'positions' && cash
        ? (account.snapshot?.spot.balances ?? []).map((b) => b.coin)
        : []),
      ...(account.snapshot?.state.assetPositions ?? []).map(
        (row) => row.position.coin,
      ),
      ...(account.snapshot?.orders ?? []).map((row) => row.coin),
      ...(account.snapshot?.fills ?? []).map((row) => row.coin),
      ...(account.snapshot?.twaps ?? []).map((row) => row.state.coin),
      ...model.chase.rows.map((row) => row.ticket.market.name),
      ...(tab === 'journal' ? journal.map((row) => row.coin) : []),
    ]),
  ].sort()
  const count =
    {
      positions: cash ? balances.length : positions.length,
      orders: orders.length,
      fills: fills.length,
      twaps: twaps.length,
      chase: chases.length,
      journal: entries.length,
    }[tab] ?? 0
  const [closing, setClosing] = useState<{
    coin: string
    kind: PositionActionKind
  } | null>(null)
  const closingPosition = account.snapshot?.state.assetPositions.find(
    (item) => item.position.coin === closing?.coin,
  )?.position
  const [marginCoin, setMarginCoin] = useState<string | null>(null)
  const [protection, setProtection] = useState<string | null>(null)
  const protectedPosition = account.snapshot?.state.assetPositions.find(
    (item) => item.position.coin === protection,
  )?.position
  useEffect(() => {
    // 切换钱包后，旧账户的操作意图不能沿用。
    void address
    setClosing(null)
    setProtection(null)
    setMarginCoin(null)
    setCoinFilter('all')
    setDirection('all')
  }, [address])
  return (
    <section
      id="trading-records"
      className="flex h-64 min-h-0 min-w-0 flex-col overflow-hidden rounded-sm lg:h-auto bg-panel md:col-span-2 lg:col-start-1 lg:row-start-2"
      aria-label={t('交易记录')}
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-0 border-b border-edge px-4">
        <Tabs
          disableAnimation={false}
          aria-label={t('交易记录类型')}
          selectedKey={tab}
          onSelectionChange={(key) => {
            setTab(String(key))
            setDirection('all')
            setCoinFilter('all')
          }}
          classNames={{ tabList: 'gap-5', tab: 'h-9' }}
        >
          <Tab key="positions" title={cash ? t('余额') : t('仓位')} />
          <Tab key="orders" title={t('当前委托')} />
          <Tab key="fills" title={t('成交记录')} />
          <Tab key="twaps" title="TWAP" />
          <Tab key="chase" title={t('追价策略')} />
          <Tab key="journal" title={t('操作记录')} />
        </Tabs>
        <div className="flex min-h-9 items-center gap-2">
          {directional && (
            <FlatSelect
              aria-label={t('方向筛选')}
              value={direction}
              onChange={setDirection}
              className="!w-24"
              placement="bottom-end"
              items={[
                { key: 'all', label: t('方向') },
                {
                  key: 'B',
                  label: tab === 'positions' ? t('多头') : t('买入'),
                },
                {
                  key: 'A',
                  label: tab === 'positions' ? t('空头') : t('卖出'),
                },
              ]}
            />
          )}
          <FlatSelect
            aria-label={t('币种筛选')}
            value={coinFilter}
            onChange={setCoinFilter}
            className="!w-32"
            placement="bottom-end"
            items={[
              { key: 'all', label: t('币种') },
              ...coins.map((coin) => ({ key: coin, label: labelFor(coin) })),
            ]}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'positions' && cash && (
          <table className="w-full text-left text-xs">
            <thead className="text-muted">
              <tr>
                {[t('资产'), t('持有数量'), t('冻结数量')].map((text) => (
                  <th className="px-4 py-3 font-normal" key={text}>
                    {t(text)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {balances.map((b) => (
                <tr
                  key={'token' in b ? b.token : b.coin}
                  className="border-t border-edge"
                >
                  <td className="px-4 py-3">
                    {b.coin.startsWith('+')
                      ? labelFor(`#${b.coin.slice(1)}`)
                      : b.coin}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{b.total}</td>
                  <td className="px-4 py-3 tabular-nums">{b.hold}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'positions' && !cash && (
          <table
            aria-label={t('仓位')}
            className="w-full min-w-[1040px] whitespace-nowrap text-right text-xs tabular-nums"
          >
            <thead className="sticky top-0 z-10 bg-panel text-muted">
              <tr>
                {[
                  '市场',
                  '仓位数量',
                  '仓位价值',
                  '开仓均价',
                  '标记价格',
                  '盈亏 / 收益率',
                  '预估清算价',
                  '保证金',
                  '资金费',
                  '平仓',
                  '止盈 / 止损',
                ].map((label, index) => (
                  <th
                    key={t(label)}
                    className={`px-3 py-3 font-normal ${index === 0 ? 'text-left' : ''}`}
                  >
                    <HelpLabel label={label} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {positions.map(({ position: p }) => {
                const positionMarket = model.markets.find(
                  (item) => item.name === p.coin,
                )
                const decimals = positionMarket
                  ? pricePrecision(positionMarket)
                  : 6
                const long = new Money(p.szi).gt(0)
                const pnlPositive = new Money(p.unrealizedPnl).gte(0)
                const mark = new Money(p.positionValue)
                  .div(new Money(p.szi).abs())
                  .toFixed()
                return (
                  <tr
                    key={p.coin}
                    className="h-14 border-t border-edge hover:bg-surface/40"
                  >
                    <td className="px-3 text-left">
                      <button
                        type="button"
                        onClick={() => model.selectMarket(p.coin)}
                        className="font-medium hover:text-accent"
                      >
                        {p.coin}{' '}
                        <span className="text-accent">{p.leverage.value}x</span>
                      </button>
                      <div
                        className={`mt-1 text-[10px] ${long ? 'text-mint' : 'text-loss'}`}
                      >
                        {t(long ? '多头' : '空头')}
                      </div>
                    </td>
                    <td
                      className={`px-3 font-mono ${long ? 'text-mint' : 'text-loss'}`}
                    >
                      {new Money(p.szi).abs().toFixed()}
                    </td>
                    <td className="px-3 font-mono">
                      {display(p.positionValue)}
                    </td>
                    <td className="px-3 font-mono">
                      {display(
                        p.entryPx,
                        Math.max(
                          decimals,
                          new Money(p.entryPx).decimalPlaces(),
                        ),
                      )}
                    </td>
                    <td className="px-3 font-mono">
                      {display(mark, decimals)}
                    </td>
                    <td
                      className={`px-3 font-mono ${pnlPositive ? 'text-mint' : 'text-loss'}`}
                    >
                      {pnlPositive ? '+' : ''}
                      {display(p.unrealizedPnl)}
                      <div className="mt-1 text-[10px]">
                        ({new Money(p.returnOnEquity).times(100).toFixed(2)}%)
                      </div>
                    </td>
                    <td className="px-3 font-mono">
                      {display(p.liquidationPx, decimals)}
                    </td>
                    <td className="px-3 font-mono">
                      {p.leverage.type === 'isolated' ? (
                        <button
                          type="button"
                          className="text-accent underline decoration-dotted underline-offset-4 disabled:text-muted"
                          aria-label={`${p.coin} ${t('调整逐仓保证金')}`}
                          disabled={!canTrade || busy}
                          onClick={() => setMarginCoin(p.coin)}
                        >
                          {display(p.marginUsed)}
                        </button>
                      ) : (
                        display(p.marginUsed)
                      )}
                      <div className="mt-1 text-[10px] text-muted">
                        {t(p.leverage.type === 'cross' ? '全仓' : '逐仓')}
                      </div>
                    </td>
                    <td
                      title={t('正数为已支付，负数为已收取；自开仓以来累计')}
                      className={`px-3 font-mono ${new Money(p.cumFunding.sinceOpen).gt(0) ? 'text-loss' : 'text-mint'}`}
                    >
                      {display(p.cumFunding.sinceOpen, 6)}
                    </td>
                    <td className="px-3">
                      <div className="flex justify-end gap-3">
                        {(
                          [
                            ['limit', '限价'],
                            ['market', '市价'],
                            ['trailing', '移动止损'],
                            ['reverse', '反手'],
                          ] as const
                        ).map(([kind, label]) => (
                          <Button
                            key={kind}
                            variant="light"
                            size="sm"
                            color="default"
                            isDisabled={!canTrade || busy}
                            onPress={() => {
                              if (
                                (kind === 'market' || kind === 'reverse') &&
                                tradePreferences.skipClose.get()
                              )
                                void model.submitPosition(p, { kind }, true)
                              else setClosing({ coin: p.coin, kind })
                            }}
                            className="h-7 min-w-0 px-0 text-accent"
                          >
                            {t(label)}
                          </Button>
                        ))}
                      </div>
                    </td>
                    <td className="px-3">
                      <Button
                        variant="light"
                        size="sm"
                        isDisabled={!canTrade || busy}
                        onPress={() => setProtection(p.coin)}
                        className="h-7 min-w-0 px-0 text-accent"
                      >
                        {t('止盈 / 止损')}
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {tab === 'orders' && (
          <table className="w-full whitespace-nowrap text-left text-xs">
            <thead className="text-muted">
              <tr>
                {[
                  t('合约'),
                  t('方向'),
                  t('委托价格'),
                  t('剩余 / 原始数量'),
                  t('类型'),
                  t('订单 ID'),
                  t('操作'),
                ].map((label) => (
                  <th key={t(label)} className="px-4 py-3 font-normal">
                    <HelpLabel label={label} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.oid} className="border-t border-edge">
                  <td className="px-4 py-4">{labelFor(order.coin)}</td>
                  <td
                    className={`px-4 ${order.side === 'B' ? 'text-mint' : 'text-loss'}`}
                  >
                    {order.side === 'B' ? t('买入') : t('卖出')}
                  </td>
                  <td className="px-4 font-mono">
                    {order.limitPx}
                    {order.isTrigger && (
                      <span className="block text-muted">
                        {t('触发')} {order.triggerPx}
                      </span>
                    )}
                  </td>
                  <td className="px-4 font-mono">
                    {order.sz} / {order.origSz}
                  </td>
                  <td className="px-4">
                    {order.orderType}
                    {order.reduceOnly && (
                      <span className="block text-muted">{t('只减仓')}</span>
                    )}
                  </td>
                  <td className="px-4 font-mono text-muted">{order.oid}</td>
                  <td className="px-4">
                    <Button
                      variant="bordered"
                      type="button"
                      isDisabled={!tradingReady || busy}
                      onClick={() => previewCancel(order)}
                      color="default"
                      size="sm"
                    >
                      {t('撤单')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'fills' && (
          <table className="w-full whitespace-nowrap text-left text-xs">
            <thead className="text-muted">
              <tr>
                {[
                  t('时间'),
                  t('合约'),
                  t('方向'),
                  t('成交价格'),
                  t('成交数量'),
                  t('手续费'),
                  t('订单 ID'),
                ].map((label) => (
                  <th key={t(label)} className="px-4 py-3 font-normal">
                    <HelpLabel label={label} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fills.map((fill) => (
                <tr key={fill.tid} className="border-t border-edge">
                  <td className="px-4 py-4 text-muted">
                    {new Date(fill.time).toLocaleTimeString('zh-CN')}
                  </td>
                  <td className="px-4">{labelFor(fill.coin)}</td>
                  <td className="px-4">{fill.dir}</td>
                  <td className="px-4 font-mono">{fill.px}</td>
                  <td className="px-4 font-mono">{fill.sz}</td>
                  <td className="px-4 font-mono">
                    {fill.fee} {fill.feeToken}
                  </td>
                  <td className="px-4 font-mono text-muted">{fill.oid}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'twaps' && (
          <table className="w-full whitespace-nowrap text-left text-xs">
            <thead className="text-muted">
              <tr>
                {[
                  t('市场 / 方向'),
                  t('已执行 / 总量'),
                  t('均价'),
                  t('时长 / 随机'),
                  t('状态'),
                  t('操作'),
                ].map((label) => (
                  <th className="px-4 py-3 font-normal" key={t(label)}>
                    <HelpLabel label={label} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {twaps.map((item, index) => (
                <tr
                  key={`${item.twapId}-${item.time}-${index}`}
                  className="border-t border-edge"
                >
                  <td className="px-4 py-3">
                    {labelFor(item.state.coin)} ·{' '}
                    {item.state.side === 'B' ? t('买入') : t('卖出')}
                  </td>
                  <td className="px-4 font-mono">
                    {item.state.executedSz} / {item.state.sz}
                  </td>
                  <td className="px-4">
                    {new Money(item.state.executedSz).gt(0)
                      ? display(
                          new Money(item.state.executedNtl)
                            .div(item.state.executedSz)
                            .toFixed(),
                        )
                      : '—'}
                  </td>
                  <td className="px-4">
                    {item.state.minutes} {t('分钟 /')}{' '}
                    {item.state.randomize ? t('是') : t('否')}
                  </td>
                  <td className="px-4">
                    {
                      {
                        activated: t('执行中'),
                        waitingForTrigger: t('等待触发'),
                        finished: t('已完成'),
                        terminated: t('已取消'),
                        stopped: t('达到停止价'),
                        error: t('失败'),
                      }[item.status.status]
                    }
                    {'description' in item.status &&
                      `：${item.status.description}`}
                  </td>
                  <td className="px-4">
                    {item.twapId != null &&
                      ['activated', 'waitingForTrigger'].includes(
                        item.status.status,
                      ) && (
                        <Button
                          size="sm"
                          variant="bordered"
                          isDisabled={!tradingReady || busy}
                          onPress={() =>
                            model.previewTwapCancel(
                              item.twapId as number,
                              item.state.coin,
                            )
                          }
                        >
                          {t('停止 TWAP')}
                        </Button>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'chase' && (
          <div className="p-4 text-xs">
            <p className="mb-3 text-muted">
              {t(
                '追价仅在当前页面运行。停止改价后，已挂订单仍可能成交，请在当前委托撤销。',
              )}
            </p>
            <ul className="divide-y divide-edge">
              {chases.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center gap-4 py-3"
                >
                  <span>
                    {marketLabel(row.ticket.market)} ·{' '}
                    {row.ticket.order.b ? t('买') : t('卖')} · #{row.oid}
                  </span>
                  <span>
                    {t('报价')} {row.price} {t('· 剩余')} {row.remaining}
                  </span>
                  <span>{row.status}</span>
                  {row.active && (
                    <Button
                      size="sm"
                      variant="bordered"
                      onPress={() => model.chase.stop(row.id)}
                    >
                      {t('停止改价')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {tab === 'journal' && (
          <ul className="divide-y divide-edge">
            {entries.map((entry, index) => (
              <li
                key={`${entry.at}-${index}`}
                className="flex flex-wrap gap-x-5 gap-y-1 px-4 py-3 text-xs"
              >
                <time className="font-mono text-muted">
                  {entry.at.slice(11, 19)} UTC
                </time>
                <span>
                  {entry.coin} · {entry.action}
                </span>
                <span
                  className={
                    entry.state === 'rejected' || entry.state === 'unconfirmed'
                      ? 'text-loss'
                      : 'text-mint'
                  }
                >
                  {entry.message}
                </span>
                {entry.oid && (
                  <span className="font-mono text-muted">#{entry.oid}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {count === 0 && (
          <div className="flex flex-col items-center gap-2 px-4 py-7 text-center text-xs text-muted">
            <Image
              src="/empty-dark.png"
              width={72}
              height={72}
              alt=""
              className="opacity-80"
            />
            <p>
              {!address
                ? t('连接钱包，查看账户交易数据')
                : direction !== 'all' || coinFilter !== 'all'
                  ? t('没有匹配的记录')
                  : t('暂无记录')}
            </p>
          </div>
        )}
      </div>
      {closingPosition && (
        <PositionClose
          key={`${closingPosition.coin}-${closing?.kind}`}
          kind={closing?.kind ?? 'market'}
          position={closingPosition}
          model={model}
          onClose={() => setClosing(null)}
        />
      )}
      {marginCoin && (
        <IsolatedMargin
          coin={marginCoin}
          model={model}
          onClose={() => setMarginCoin(null)}
        />
      )}
      {protectedPosition && (
        <PositionProtection
          position={protectedPosition}
          model={model}
          onClose={() => setProtection(null)}
        />
      )}
    </section>
  )
}
