'use client'
import { Button, Input, Tab, Tabs } from '@fameex/ui'
import Image from 'next/image'
import { useState } from 'react'
import type { TerminalModel } from '@/hooks/use-terminal'
import { display } from '@/lib/display'
import { isCash, marketLabel } from '@/lib/market-catalog'
import { Money } from '@/lib/orders'
import { PositionProtection } from './position-protection'
export function TradingRecords({ model }: { model: TerminalModel }) {
  const {
    account,
    journal,
    address,
    closeSizes,
    setCloseSizes,
    canTrade,
    tradingReady,
    busy,
    previewClose,
    previewCancel,
    exportEvidence,
  } = model
  const cash = isCash(model.market)
  const labelFor = (coin: string) => {
    const market = model.markets.find((m) => m.name === coin)
    return market ? marketLabel(market) : coin
  }
  const [tab, setTab] = useState('positions')
  const [protection, setProtection] = useState<string | null>(null)
  return (
    <section
      id="trading-records"
      className="flex h-64 min-h-0 min-w-0 flex-col overflow-hidden rounded-sm lg:h-auto bg-panel md:col-span-2 lg:col-start-1 lg:row-start-2"
      aria-label="交易记录"
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-0 border-b border-edge px-4">
        <Tabs
          disableAnimation={false}
          aria-label="交易记录类型"
          selectedKey={tab}
          onSelectionChange={(key) => setTab(String(key))}
          classNames={{ tabList: 'gap-5', tab: 'h-9' }}
        >
          <Tab key="positions" title={cash ? '余额' : '仓位'} />
          <Tab key="orders" title="当前委托" />
          <Tab key="fills" title="成交记录" />
          <Tab key="twaps" title="TWAP" />
          <Tab key="chase" title="追价策略" />
          <Tab key="journal" title="操作记录" />
        </Tabs>
        <div className="flex min-h-9 items-center gap-4">
          <Button
            variant="light"
            type="button"
            onClick={account.refresh}
            className="text-xs text-muted hover:text-ink"
          >
            刷新
          </Button>
          <Button
            variant="light"
            type="button"
            onClick={exportEvidence}
            className="text-xs text-accent hover:text-ink"
          >
            导出验证记录 ↗
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'positions' && cash && (
          <table className="w-full text-left text-xs">
            <thead className="text-muted">
              <tr>
                {['资产', '持有数量', '冻结数量'].map((text) => (
                  <th className="px-4 py-3 font-normal" key={text}>
                    {text}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {account.snapshot?.spot?.balances
                .filter((b) => Number(b.total) !== 0 || Number(b.hold) !== 0)
                .map((b) => (
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
          <table className="w-full whitespace-nowrap text-left text-xs">
            <thead className="text-muted">
              <tr>
                {[
                  '合约 / 杠杆',
                  '仓位数量',
                  '开仓均价',
                  '未实现盈亏',
                  '预估清算价',
                  '保证金',
                  '减仓数量 / 操作',
                ].map((label) => (
                  <th key={label} className="px-4 py-3 font-normal">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {account.snapshot?.state.assetPositions
                .filter((p) => new Money(p.position.szi).abs().gt(0))
                .map(({ position: p }) => (
                  <tr key={p.coin} className="border-t border-edge">
                    <td className="px-4 py-4 font-medium">
                      {p.coin}{' '}
                      <span className="text-muted">
                        {p.leverage.type === 'cross' ? '全仓' : '逐仓'}{' '}
                        {p.leverage.value}x
                      </span>
                    </td>
                    <td
                      className={`px-4 font-mono ${new Money(p.szi).gte(0) ? 'text-mint' : 'text-loss'}`}
                    >
                      {p.szi}
                    </td>
                    <td className="px-4 font-mono">{p.entryPx}</td>
                    <td
                      className={`px-4 font-mono ${new Money(p.unrealizedPnl).gte(0) ? 'text-mint' : 'text-loss'}`}
                    >
                      {display(p.unrealizedPnl)}
                    </td>
                    <td className="px-4 font-mono">
                      {display(p.liquidationPx)}
                    </td>
                    <td className="px-4 font-mono">{display(p.marginUsed)}</td>
                    <td className="flex gap-2 px-4 py-3">
                      <Input
                        aria-label={`${p.coin} 减仓数量`}
                        className="w-28"
                        value={
                          closeSizes[p.coin] ?? new Money(p.szi).abs().toFixed()
                        }
                        onChange={(value) =>
                          setCloseSizes((previous) => ({
                            ...previous,
                            [p.coin]: value,
                          }))
                        }
                        inputMode="decimal"
                      />
                      <Button
                        variant="bordered"
                        type="button"
                        isDisabled={!canTrade || busy}
                        onClick={() => previewClose(p)}
                        color="default"
                        size="sm"
                        className="shrink-0"
                      >
                        减仓 / 平仓
                      </Button>
                      <Button
                        variant="bordered"
                        size="sm"
                        isDisabled={!canTrade || busy}
                        onPress={() => setProtection(p.coin)}
                      >
                        止盈 / 止损
                      </Button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
        {tab === 'orders' && (
          <table className="w-full whitespace-nowrap text-left text-xs">
            <thead className="text-muted">
              <tr>
                {[
                  '合约',
                  '方向',
                  '委托价格',
                  '剩余 / 原始数量',
                  '类型',
                  '订单 ID',
                  '操作',
                ].map((label) => (
                  <th key={label} className="px-4 py-3 font-normal">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {account.snapshot?.orders.map((order) => (
                <tr key={order.oid} className="border-t border-edge">
                  <td className="px-4 py-4">{labelFor(order.coin)}</td>
                  <td
                    className={`px-4 ${order.side === 'B' ? 'text-mint' : 'text-loss'}`}
                  >
                    {order.side === 'B' ? '买入' : '卖出'}
                  </td>
                  <td className="px-4 font-mono">
                    {order.limitPx}
                    {order.isTrigger && (
                      <span className="block text-muted">
                        触发 {order.triggerPx}
                      </span>
                    )}
                  </td>
                  <td className="px-4 font-mono">
                    {order.sz} / {order.origSz}
                  </td>
                  <td className="px-4">
                    {order.orderType}
                    {order.reduceOnly && (
                      <span className="block text-muted">只减仓</span>
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
                      撤单
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
                  '时间',
                  '合约',
                  '方向',
                  '成交价格',
                  '成交数量',
                  '手续费',
                  '订单 ID',
                ].map((label) => (
                  <th key={label} className="px-4 py-3 font-normal">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {account.snapshot?.fills.map((fill) => (
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
                  '市场 / 方向',
                  '已执行 / 总量',
                  '均价',
                  '时长 / 随机',
                  '状态',
                  '操作',
                ].map((label) => (
                  <th className="px-4 py-3 font-normal" key={label}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {account.snapshot?.twaps.map((item, index) => (
                <tr
                  key={`${item.twapId}-${item.time}-${index}`}
                  className="border-t border-edge"
                >
                  <td className="px-4 py-3">
                    {labelFor(item.state.coin)} ·{' '}
                    {item.state.side === 'B' ? '买入' : '卖出'}
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
                    {item.state.minutes} 分钟 /{' '}
                    {item.state.randomize ? '是' : '否'}
                  </td>
                  <td className="px-4">
                    {
                      {
                        activated: '执行中',
                        waitingForTrigger: '等待触发',
                        finished: '已完成',
                        terminated: '已取消',
                        stopped: '达到停止价',
                        error: '失败',
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
                          停止 TWAP
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
              追价仅在当前页面运行。停止改价后，已挂订单仍可能成交，请在当前委托撤销。
            </p>
            <ul className="divide-y divide-edge">
              {model.chase.rows.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center gap-4 py-3"
                >
                  <span>
                    {marketLabel(row.ticket.market)} ·{' '}
                    {row.ticket.order.b ? '买' : '卖'} · #{row.oid}
                  </span>
                  <span>
                    报价 {row.price} · 剩余 {row.remaining}
                  </span>
                  <span>{row.status}</span>
                  {row.active && (
                    <Button
                      size="sm"
                      variant="bordered"
                      onPress={() => model.chase.stop(row.id)}
                    >
                      停止改价
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {tab === 'journal' && (
          <ul className="divide-y divide-edge">
            {journal.map((entry, index) => (
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
        {((tab === 'positions' &&
          !account.snapshot?.state.assetPositions.length) ||
          (tab === 'orders' && !account.snapshot?.orders.length) ||
          (tab === 'fills' && !account.snapshot?.fills.length) ||
          (tab === 'twaps' && !account.snapshot?.twaps.length) ||
          (tab === 'chase' && !model.chase.rows.length) ||
          (tab === 'journal' && !journal.length)) && (
          <div className="flex flex-col items-center gap-2 px-4 py-7 text-center text-xs text-muted">
            <Image
              src="/empty-dark.png"
              width={72}
              height={72}
              alt=""
              className="opacity-80"
            />
            <p>
              {address
                ? '暂无记录'
                : '连接钱包或输入公开地址，查看账户交易数据'}
            </p>
          </div>
        )}
      </div>
      {protection && (
        <PositionProtection
          coin={protection}
          onClose={() => setProtection(null)}
          onPreview={model.previewProtection}
        />
      )}
    </section>
  )
}
