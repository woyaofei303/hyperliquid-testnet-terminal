'use client'
import {
  TpslDirection,
  TpslEstimateType,
  type TpslOverlayData,
  type UseBaseKlineChartResult,
  useTpslOverlay,
} from '@fameex/kline'
import { Button, Modal } from '@fameex/ui'
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  type ProtectionKind,
  positionProtections,
  protectionKind,
} from '@/features/chart/lib/chart-trading'
import { baseName, quoteName } from '@/features/market/lib/market-catalog'
import type { TerminalModel } from '@/features/terminal/hooks/use-terminal'
import { formatOrderPrice, Money } from '@/features/trading/lib/orders'
import { t, useLocale } from '@/i18n'
import type { OpenOrder } from '@/shared/lib/fameex-testnet'
import { PositionClose } from '../../trading/components/position-close'
import { PositionProtection } from '../../trading/components/position-protection'

const texts: Record<string, string> = {
  tpsl_limit: '限价单',
  tpsl_take_profit_stop_loss: '止盈 / 止损',
  tpsl_take_profit: '止盈',
  tpsl_stop_loss: '止损',
  tpsl_profit_amount: '收益额',
  tpsl_estimated_profit: '预估收益',
  tpsl_estimated_loss: '预估亏损',
}
const translate = (key: string) => t(texts[key] ?? key)
type Visibility = { position: boolean; order: boolean; tpslOrder: boolean }
type Draft = { kind: ProtectionKind; value: string; order?: OpenOrder }

// 行情高频更新只通知交易层，避免让整个 Chart 绕过 memo 重渲染。
export const ChartTradingContext = createContext<TerminalModel | null>(null)
type Props = {
  chart: UseBaseKlineChartResult
  visibility: Visibility
  visible: boolean
}
export function ChartTradeLines(props: Props) {
  const model = useContext(ChartTradingContext)
  return model ? (
    <AccountTradeLines
      key={`${model.coin}:${model.wallet?.address ?? ''}`}
      {...props}
      model={model}
    />
  ) : null
}
// 账户或币种变化时，同时清理图形和待确认弹窗。
function AccountTradeLines({
  chart,
  model,
  visibility,
  visible,
}: Props & { model: TerminalModel }) {
  const locale = useLocale()
  const latest = useRef(model)
  latest.current = model
  const [dialog, setDialog] = useState<
    'close' | 'choose' | 'protection' | null
  >(null)
  const [draft, setDraft] = useState<Draft>()
  const [revision, setRevision] = useState(0)
  const snapshot = model.account.snapshot
  const market = model.market
  const matching =
    snapshot?.address.toLowerCase() === model.wallet?.address.toLowerCase()
  const position = matching
    ? snapshot?.state.assetPositions.find(
        (p) => p.position.coin === model.coin && Number(p.position.szi) !== 0,
      )?.position
    : undefined
  const orders = useMemo(
    () =>
      matching
        ? (snapshot?.orders.filter((order) => order.coin === model.coin) ?? [])
        : [],
    [matching, snapshot, model.coin],
  )
  const protections = useMemo(
    () => (position ? positionProtections(position, orders) : {}),
    [position, orders],
  )
  const enabled = visible && model.canTrade && !model.busy && !dialog
  function close() {
    setDialog(null)
    setDraft(undefined)
    setRevision((value) => value + 1)
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: t 读取外部语言状态，切换语言也必须重建画布文案。
  const data = useMemo(() => {
    if (!market) return []
    const writable = () =>
      latest.current.canTrade &&
      !latest.current.busy &&
      latest.current.coin === market.name &&
      latest.current.wallet?.address === snapshot?.address
    const open = (
      kind: ProtectionKind,
      value?: number,
      originalKind = kind,
    ) => {
      if (!writable()) return
      if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
        setRevision((value) => value + 1)
        return
      }
      const order = protections[originalKind]
      // 修改不能把止盈隐式改成止损；跨线拖动恢复原侧，提交校验会提示无效价格。
      setDraft({
        kind: order ? originalKind : kind,
        value:
          value === undefined
            ? (order?.triggerPx ?? '')
            : formatOrderPrice(String(value), market),
        order,
      })
      setDialog('protection')
    }
    const result: TpslOverlayData[] = []
    const attached = new Set(
      visibility.tpslOrder ? [protections.tp?.oid, protections.sl?.oid] : [],
    )
    if (position) {
      const estimate = (price: number) =>
        `${new Money(price).minus(position.entryPx).times(position.szi).toFixed(2)} ${quoteName(market)}`
      const kind = (value: TpslEstimateType | null) =>
        value === TpslEstimateType.TakeProfit
          ? ('tp' as const)
          : ('sl' as const)
      result.push({
        id: `position:${snapshot?.address}:${market.name}:${revision}`,
        lineType: 'position',
        mainValue: Number(position.entryPx),
        direction:
          Number(position.szi) > 0 ? TpslDirection.Long : TpslDirection.Short,
        profitPercent: `${new Money(position.unrealizedPnl).toFixed(2)} ${quoteName(market)} · ${t('收益率')} ${new Money(position.returnOnEquity).times(100).toFixed(2)}%`,
        positionAmount: `${new Money(position.szi).abs().toFixed()} ${baseName(market)}`,
        reducePrice: Number(position.liquidationPx) || null,
        takeProfitValue:
          dialog === 'protection' && draft?.kind === 'tp'
            ? Number(draft.value) || null
            : visibility.tpslOrder && protections.tp
              ? Number(protections.tp.triggerPx)
              : null,
        stopLossValue:
          dialog === 'protection' && draft?.kind === 'sl'
            ? Number(draft.value) || null
            : visibility.tpslOrder && protections.sl
              ? Number(protections.sl.triggerPx)
              : null,
        takeProfitText: protections.tp
          ? `${t('止盈')} ${protections.tp.triggerPx} · ${estimate(Number(protections.tp.triggerPx))}`
          : undefined,
        stopLossText: protections.sl
          ? `${t('止损')} ${protections.sl.triggerPx} · ${estimate(Number(protections.sl.triggerPx))}`
          : undefined,
        getEstimateText: (price, type) =>
          `${t(type === TpslEstimateType.TakeProfit ? '止盈' : '止损')} ${formatOrderPrice(String(price), market)} · ${estimate(price)}`,
        ...(enabled
          ? {
              onClose: () => {
                if (writable()) setDialog('close')
              },
              onOpenTpslModal: () => {
                if (writable()) setDialog('choose')
              },
              onOpenEstimateModal: (type?: TpslEstimateType) => {
                if (type) open(kind(type))
                else if (writable()) setDialog('choose')
              },
              onFirstDragEnd: ({ estimateType, estimateValue }) =>
                open(kind(estimateType), estimateValue),
              onEstimateDragEnd: ({
                estimateType,
                estimateValue,
                originalEstimateType,
              }) =>
                open(
                  kind(estimateType),
                  estimateValue,
                  kind(originalEstimateType ?? estimateType),
                ),
              onEstimateClose: ({ estimateType }) => {
                const order = protections[kind(estimateType)]
                if (order && writable()) latest.current.previewCancel(order)
              },
            }
          : {}),
      })
    }
    for (const order of orders) {
      if (visibility.position && attached.has(order.oid)) continue
      const price = Number(order.isTrigger ? order.triggerPx : order.limitPx)
      if (!Number.isFinite(price) || price <= 0) continue
      result.push({
        id: `order:${snapshot?.address}:${order.oid}:${revision}`,
        lineType: order.isTrigger ? 'tpslOrder' : 'order',
        mainValue: price,
        direction:
          order.side === 'B' ? TpslDirection.Long : TpslDirection.Short,
        orderPriceText: `${order.isTrigger ? order.triggerPx : order.limitPx} · ${order.sz} ${baseName(market)}`,
        orderLabelText: order.isTrigger
          ? t(
              protectionKind(order) === 'tp'
                ? '止盈'
                : protectionKind(order) === 'sl'
                  ? '止损'
                  : '条件单',
            )
          : t(order.side === 'B' ? '买入' : '卖出'),
        ...(enabled
          ? {
              onClose: () => {
                if (writable()) latest.current.previewCancel(order)
              },
            }
          : {}),
      })
    }
    return result
  }, [
    market,
    snapshot,
    position,
    protections,
    orders,
    enabled,
    visibility,
    locale,
    dialog,
    draft,
    revision,
  ])
  const hasPosition = !!position
  useEffect(() => {
    if (!hasPosition || !visible) {
      setDialog(null)
      setDraft(undefined)
      setRevision((value) => value + 1)
    }
  }, [hasPosition, visible])
  const activePosition = position && dialog
  return (
    <>
      <TradeOverlay
        key={revision}
        chart={chart}
        data={data}
        visibility={visibility}
        visible={visible}
      />
      <div
        role="toolbar"
        aria-label={t('图表交易操作')}
        className="sr-only focus-within:not-sr-only focus-within:absolute focus-within:bottom-8 focus-within:left-12 focus-within:z-30 focus-within:flex focus-within:flex-wrap focus-within:gap-2 focus-within:bg-panel focus-within:p-2"
      >
        {position && (
          <>
            <button
              type="button"
              disabled={!enabled}
              onClick={() => setDialog('close')}
            >
              {t('图表平仓')}
            </button>
            <button
              type="button"
              disabled={!enabled}
              onClick={() => setDialog('choose')}
            >
              {t('图表止盈止损')}
            </button>
          </>
        )}
        {orders.map((order) => (
          <button
            type="button"
            key={order.oid}
            disabled={!enabled}
            onClick={() => model.previewCancel(order)}
          >
            {t('图表撤单')} #{order.oid}
          </button>
        ))}
      </div>
      {activePosition && dialog === 'choose' && (
        <Modal title={t('止盈 / 止损')} onClose={close} closeLabel={t('关闭')}>
          <div className="grid grid-cols-2 gap-3">
            {(['tp', 'sl'] as const).map((kind) => (
              <Button
                key={kind}
                variant="flat"
                onPress={() => {
                  setDraft({
                    kind,
                    value: protections[kind]?.triggerPx ?? '',
                    order: protections[kind],
                  })
                  setDialog('protection')
                }}
              >
                {t(kind === 'tp' ? '止盈' : '止损')}{' '}
                {protections[kind]?.triggerPx ?? '+'}
              </Button>
            ))}
          </div>
        </Modal>
      )}
      {activePosition && dialog === 'close' && (
        <PositionClose
          position={position}
          model={model}
          kind="market"
          onClose={close}
        />
      )}
      {activePosition && dialog === 'protection' && (
        <PositionProtection
          position={position}
          model={model}
          initial={draft}
          onClose={close}
        />
      )}
    </>
  )
}
function TradeOverlay({
  chart,
  data,
  visibility,
  visible,
}: {
  chart: UseBaseKlineChartResult
  data: TpslOverlayData[]
  visibility: Visibility
  visible: boolean
}) {
  useTpslOverlay({
    chartRef: chart.chartRef,
    overlayApi: chart.overlayApi,
    initialized: chart.isReady && !chart.isDataLoading && visible,
    data,
    translate,
    lineTypeVisibility: visibility,
  })
  return null
}
