import { Button, Checkbox, FlatSelect } from '@fameex/ui'
import { useCallback, useMemo, useState } from 'react'
import { useAccountHistory } from '@/hooks/use-account-history'
import type { TerminalModel } from '@/hooks/use-terminal'
import { t, useLocale } from '@/i18n'
import { historyKey, orderStatusLabel, recordsCsv } from '@/lib/account-records'
import { display } from '@/lib/display'
import { marketLabel } from '@/lib/market-catalog'
import { Money } from '@/lib/orders'

export function AccountHistory({
  model,
  kind,
}: {
  model: TerminalModel
  kind: 'history' | 'funding' | 'fills' | 'twapFills'
}) {
  const locale = useLocale()
  const [days, setDays] = useState(kind === 'funding' ? '30' : 'all')
  const [coin, setCoin] = useState('all'),
    [side, setSide] = useState('all'),
    [type, setType] = useState('all'),
    [role, setRole] = useState('all')
  const [aggregate, setAggregate] = useState(false),
    [limit, setLimit] = useState(25)
  const [page, setPage] = useState(0)
  const startTime = useMemo(
    () => (days === 'all' ? 0 : Date.now() - Number(days) * 86400000),
    [days],
  )
  const history = useAccountHistory(model.address, kind, startTime, aggregate)
  const labels = useMemo(
    () => new Map(model.markets.map((m) => [m.name, marketLabel(m)])),
    [model.markets],
  )
  const labelFor = useCallback(
    (coin: string) => labels.get(coin) ?? coin,
    [labels],
  )
  const headers =
    kind === 'history'
      ? [
          '时间',
          '市场',
          '方向',
          '类型',
          '数量',
          '成交大小',
          '订单价值',
          '价格',
          '只减仓',
          '触发条件',
          '止盈 / 止损',
          '状态',
          '订单 ID',
        ]
      : kind === 'funding'
        ? ['时间', '市场', '数量', '方向', '支付', '利率']
        : [
            '时间',
            '市场',
            '方向',
            '价格',
            '数量',
            '成交价值',
            '手续费',
            '已实现盈亏',
            '角色',
            kind === 'twapFills' ? 'TWAP ID' : '订单 ID',
          ]
  const rows = useMemo(() => {
    void locale
    const date = (time: number) => new Date(time).toLocaleString()
    return kind === 'history'
      ? history.data.orders.map((item) => {
          const o = item.order
          const marketPrice = o.orderType.includes('Market')
          return {
            key: historyKey(o.oid, item.status, item.statusTimestamp),
            time: item.statusTimestamp,
            coin: o.coin,
            side: o.side,
            type: o.orderType,
            role: '',
            cells: [
              date(item.statusTimestamp),
              labelFor(o.coin),
              t(
                o.reduceOnly
                  ? o.side === 'B'
                    ? '平空'
                    : '平多'
                  : o.side === 'B'
                    ? '买入'
                    : '卖出',
              ),
              o.orderType,
              o.sz,
              Money.max(0, new Money(o.origSz).minus(o.sz)).toFixed(),
              marketPrice
                ? '—'
                : display(new Money(o.origSz).times(o.limitPx).toFixed(), 2),
              marketPrice ? t('市价') : o.limitPx,
              t(o.reduceOnly ? '是' : '否'),
              o.triggerCondition || 'N/A',
              o.children
                ?.map((c) => `${c.orderType} ${c.triggerPx}`)
                .join(' / ') || '—',
              t(orderStatusLabel(item.status)),
              String(o.oid),
            ],
          }
        })
      : kind === 'funding'
        ? history.data.funding.map((item) => ({
            key: `${item.hash}:${item.time}:${item.delta.coin}`,
            time: item.time,
            coin: item.delta.coin,
            side: new Money(item.delta.szi).gte(0) ? 'B' : 'A',
            type: '',
            role: '',
            cells: [
              date(item.time),
              labelFor(item.delta.coin),
              new Money(item.delta.szi).abs().toFixed(),
              t(new Money(item.delta.szi).gte(0) ? '多头' : '空头'),
              `${item.delta.usdc} USDC`,
              `${new Money(item.delta.fundingRate).times(100).toFixed()}%`,
            ],
          }))
        : (kind === 'twapFills'
            ? history.data.twapFills
            : history.data.fills.map((fill) => ({ fill, twapId: null }))
          ).map(({ fill: f, twapId }) => ({
            key: `${f.coin}:${f.tid}:${f.hash}`,
            time: f.time,
            coin: f.coin,
            side: f.side,
            type: 'liquidation' in f && f.liquidation ? '强平' : '普通成交',
            role: f.crossed ? 'Taker' : 'Maker',
            cells: [
              date(f.time),
              labelFor(f.coin),
              f.dir,
              f.px,
              f.sz,
              display(new Money(f.px).times(f.sz).toFixed(), 4),
              `${f.fee} ${f.feeToken}`,
              f.closedPnl,
              f.crossed ? 'Taker' : 'Maker',
              String(twapId ?? f.oid),
            ],
          }))
  }, [history.data, kind, labelFor, locale])
  const filtered = rows
    .filter(
      (row) =>
        row.time >= startTime &&
        (coin === 'all' || row.coin === coin) &&
        (side === 'all' || row.side === side) &&
        (type === 'all' || row.type === type) &&
        (role === 'all' || row.role === role),
    )
    .sort((a, b) => b.time - a.time)
  const visiblePage = Math.min(
    page,
    Math.max(0, Math.ceil(filtered.length / limit) - 1),
  )
  function filter(setter: (value: string) => void) {
    return (value: string) => {
      setter(value)
      setLimit(25)
      setPage(0)
    }
  }
  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-edge bg-panel px-3 py-1.5 text-xs">
        <FlatSelect
          aria-label={t('历史时间范围')}
          value={days}
          onChange={filter(setDays)}
          items={[
            { key: 'all', label: t('全部时间') },
            { key: '7', label: t('近 7 天') },
            { key: '30', label: t('近 30 天') },
            { key: '90', label: t('近 90 天') },
          ]}
        />
        {kind !== 'funding' && (
          <FlatSelect
            aria-label={t('类型筛选')}
            value={type}
            onChange={filter(setType)}
            items={[
              { key: 'all', label: t('类型') },
              ...[...new Set(rows.map((r) => r.type))]
                .filter(Boolean)
                .map((key) => ({ key, label: t(key) })),
            ]}
          />
        )}
        <FlatSelect
          aria-label={t('历史方向筛选')}
          value={side}
          onChange={filter(setSide)}
          items={[
            { key: 'all', label: t('方向') },
            { key: 'B', label: t(kind === 'funding' ? '多头' : '买入') },
            { key: 'A', label: t(kind === 'funding' ? '空头' : '卖出') },
          ]}
        />
        <FlatSelect
          aria-label={t('历史市场筛选')}
          value={coin}
          onChange={filter(setCoin)}
          items={[
            { key: 'all', label: t('市场') },
            ...[...new Set(rows.map((r) => r.coin))]
              .sort()
              .map((key) => ({ key, label: labelFor(key) })),
          ]}
        />
        {(kind === 'fills' || kind === 'twapFills') && (
          <FlatSelect
            aria-label={t('角色筛选')}
            value={role}
            onChange={filter(setRole)}
            items={['all', 'Maker', 'Taker'].map((key) => ({
              key,
              label: key === 'all' ? t('角色') : key,
            }))}
          />
        )}
        {kind === 'fills' && (
          <Checkbox isSelected={aggregate} onValueChange={setAggregate}>
            {t('汇总成交')}
          </Checkbox>
        )}
        <Button
          size="sm"
          variant="light"
          isDisabled={history.loading || !model.address}
          onPress={history.retry}
        >
          {t('刷新')}
        </Button>
      </div>
      {history.error && (
        <p role="alert" className="p-4 text-xs text-loss">
          {t('记录加载失败：')}
          {history.error}
          <Button size="sm" variant="light" onPress={history.retry}>
            {t('重试')}
          </Button>
        </p>
      )}
      <table
        aria-label={t(
          {
            history: '历史委托',
            funding: '资金费历史',
            fills: '历史成交',
            twapFills: 'TWAP 成交历史',
          }[kind],
        )}
        className="w-full whitespace-nowrap text-left text-xs tabular-nums"
      >
        <thead className="bg-panel text-muted">
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-3 py-3 font-normal">
                {t(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered
            .slice(visiblePage * limit, (visiblePage + 1) * limit)
            .map((row) => (
              <tr
                key={row.key}
                className="border-t border-edge hover:bg-surface/50"
              >
                {row.cells.map((cell, index) => (
                  <td
                    key={headers[index]}
                    className={`max-w-80 truncate px-3 py-2 ${index === 1 ? 'text-accent' : ''}`}
                    title={cell}
                  >
                    {index === 1 &&
                    model.markets.some((m) => m.name === row.coin) ? (
                      <button
                        type="button"
                        onClick={() => model.selectMarket(row.coin)}
                      >
                        {cell}
                      </button>
                    ) : (
                      cell
                    )}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
      {!filtered.length && !history.error && (
        <output className="p-8 text-center text-xs text-muted">
          {t(
            !model.address
              ? '连接钱包，查看账户交易数据'
              : history.loading
                ? '正在加载记录…'
                : '暂无记录',
          )}
        </output>
      )}
      {!!filtered.length && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-edge px-3 py-2 text-xs text-muted">
          <span>
            {Math.min(visiblePage * limit + 1, filtered.length)}–
            {Math.min((visiblePage + 1) * limit, filtered.length)} /{' '}
            {filtered.length} {t('条记录')}
            {history.loading ? ` · ${t('刷新中…')}` : ''}
          </span>
          {limit === 25 && limit < filtered.length && (
            <Button
              size="sm"
              variant="light"
              onPress={() => {
                setLimit(100)
                setPage(0)
              }}
            >
              {t('查看全部')}
            </Button>
          )}
          {limit === 100 && filtered.length > limit && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="light"
                isDisabled={visiblePage === 0}
                onPress={() => setPage(visiblePage - 1)}
              >
                {t('上一页')}
              </Button>
              <Button
                size="sm"
                variant="light"
                isDisabled={(visiblePage + 1) * limit >= filtered.length}
                onPress={() => setPage(visiblePage + 1)}
              >
                {t('下一页')}
              </Button>
            </div>
          )}
          <Button
            size="sm"
            variant="light"
            onPress={() => {
              const url = URL.createObjectURL(
                new Blob(
                  [
                    recordsCsv(
                      headers.map(t),
                      filtered.map((row) => row.cells),
                    ),
                  ],
                  { type: 'text/csv;charset=utf-8' },
                ),
              )
              const link = document.createElement('a')
              link.href = url
              link.download = `${kind}-${new Date().toISOString().slice(0, 10)}.csv`
              link.click()
              URL.revokeObjectURL(url)
            }}
          >
            {t('导出为 CSV')}
          </Button>
          <span>
            {t(
              kind === 'funding'
                ? '支付为负表示付出，为正表示收到。'
                : kind === 'history'
                  ? '交易所最多返回最近 2000 笔委托。'
                  : '交易所最多返回最近 2000 笔成交；盈亏不含手续费。',
            )}
          </span>
        </div>
      )}
    </div>
  )
}
