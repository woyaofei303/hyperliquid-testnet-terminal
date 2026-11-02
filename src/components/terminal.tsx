'use client'
import { Button, Checkbox } from '@fameex/ui'
import { Profiler, useState } from 'react'
import { useTerminal } from '@/hooks/use-terminal'
import {
  isCash,
  marketLabel,
  pricePrecision,
  quoteName,
} from '@/lib/market-catalog'
import { recordReactRender } from '@/lib/performance'
import { Chart } from './chart'
import { ModuleBoundary } from './module-boundary'
import { OrderForm } from './order-form'
import { PerformancePanel } from './performance-panel'
import { AccountPanel } from './trading/account-panel'
import { AccountTypeSetting } from './trading/account-type-setting'
import { CashOrderForm } from './trading/cash-order-form'
import { ConfirmDialog } from './trading/confirm-dialog'
import { Header } from './trading/header'
import { MarketHeader } from './trading/market-header'
import { OrderBook } from './trading/order-book'
import { TradingRecords } from './trading/records'
import { Web3Dialog } from './trading/web3-dialog'
export function Terminal() {
  const model = useTerminal()
  const [acknowledged, setAcknowledged] = useState(false)
  const {
    market,
    coin,
    interval,
    setIntervalValue,
    feed,
    account,
    unresolved,
    resolving,
    busy,
    canTrade,
    action,
    setAction,
  } = model
  return (
    <main className="relative flex h-dvh min-h-0 flex-col overflow-hidden">
      <Header model={model} />
      <div className="flex min-h-0 flex-1 flex-col px-0.5 pt-0.5">
        {unresolved && !busy && (
          <div
            role="alert"
            className="mb-0.5 flex max-h-[25dvh] shrink-0 flex-wrap items-center justify-between gap-3 overflow-y-auto rounded-lg border border-amber-200/20 bg-panel p-3 text-xs text-amber-200 shadow-xl"
          >
            <span>
              有一笔订单结果待确认。{unresolved.coin} ·{' '}
              {unresolved.cloid.slice(0, 12)}…
            </span>
            <Button
              variant="bordered"
              color="default"
              size="sm"
              onPress={model.reconcile}
              isDisabled={busy || resolving}
              className="shrink-0"
            >
              查询未确认订单
            </Button>
            {unresolved.native && (
              <div className="flex items-center gap-3">
                <Checkbox
                  isSelected={acknowledged}
                  onValueChange={setAcknowledged}
                >
                  已在官方页面核对委托、成交及 TWAP
                </Checkbox>
                <Button
                  size="sm"
                  variant="bordered"
                  isDisabled={!acknowledged || busy}
                  onPress={() => {
                    model.acknowledgeNative()
                    setAcknowledged(false)
                  }}
                >
                  核对后解除本地保护
                </Button>
              </div>
            )}
          </div>
        )}
        <div className="grid min-h-0 flex-1 auto-rows-max gap-0.5 overflow-y-auto lg:auto-rows-auto lg:overflow-hidden md:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_228px_264px] lg:grid-rows-[minmax(0,1fr)_minmax(140px,23%)] xl:grid-cols-[minmax(0,1fr)_18.6%_18.6%]">
          <section
            className="flex min-h-[504px] min-w-0 flex-col overflow-hidden rounded-sm bg-panel md:col-span-2 md:min-h-[564px] lg:col-span-1 lg:min-h-0"
            aria-label="行情图表"
          >
            <MarketHeader model={model} />
            <ModuleBoundary name="图表">
              <Profiler id="chartReact" onRender={recordReactRender}>
                <Chart
                  coin={coin}
                  label={
                    market
                      ? `${marketLabel(market)} ${isCash(market) ? (market.kind === 'outcome' ? '预测' : '现货') : '永续'}`
                      : undefined
                  }
                  priceDecimals={market ? pricePrecision(market) : 1}
                  interval={interval}
                  onIntervalChange={setIntervalValue}
                  candles={feed.candles}
                  szDecimals={market?.szDecimals ?? 5}
                />
              </Profiler>
            </ModuleBoundary>
          </section>
          <ModuleBoundary name="订单簿">
            <Profiler id="bookReact" onRender={recordReactRender}>
              <OrderBook model={model} />
            </Profiler>
          </ModuleBoundary>
          <aside
            className="grid min-h-0 min-w-0 gap-0.5 lg:col-start-3 lg:row-span-2 lg:row-start-1 lg:grid-rows-subgrid"
            aria-label="交易侧栏"
          >
            <ModuleBoundary name="下单面板">
              {market ? (
                <Profiler id="orderReact" onRender={recordReactRender}>
                  {isCash(market) ? (
                    <CashOrderForm key={coin} model={model} market={market} />
                  ) : (
                    <OrderForm
                      market={market}
                      book={feed.book}
                      stale={feed.stale}
                      enabled={canTrade}
                      onboarding={model.onboarding}
                      onOnboarding={() =>
                        !model.wallet
                          ? model.connect()
                          : model.previewApproval()
                      }
                      busy={busy}
                      address={model.address}
                      refreshAt={account.snapshot?.at ?? 0}
                      onTicket={model.previewTicket}
                      position={
                        account.snapshot?.state.assetPositions.find(
                          (item) => item.position.coin === coin,
                        )?.position.szi ?? '0'
                      }
                      onLeverage={model.previewLeverage}
                      accountType={
                        <AccountTypeSetting
                          key={model.address}
                          mode={account.snapshot?.mode ?? null}
                          connected={!!model.wallet}
                          busy={busy}
                          onApply={model.changeAccountType}
                        />
                      }
                    />
                  )}
                </Profiler>
              ) : (
                <p className="bg-panel p-4 text-sm text-muted">
                  正在加载市场配置…
                </p>
              )}
            </ModuleBoundary>
            <ModuleBoundary name="账户概览">
              <AccountPanel model={model} />
            </ModuleBoundary>
          </aside>
          <ModuleBoundary
            name="交易记录"
            className="md:col-span-2 lg:col-start-1 lg:row-start-2"
          >
            <Profiler id="recordsReact" onRender={recordReactRender}>
              <TradingRecords model={model} />
            </Profiler>
          </ModuleBoundary>
        </div>
        <footer className="flex min-h-8 shrink-0 flex-wrap items-center justify-between gap-2 px-3 py-1 text-[11px] text-muted">
          <span className={feed.stale ? 'text-amber-300' : 'text-accent'}>
            ● {feed.stale ? '行情未就绪 / 已过期' : feed.status}
          </span>
          <div className="flex items-center gap-3">
            <PerformancePanel />
            <span>{quoteName(market)} · 以交易所返回为准</span>
          </div>
        </footer>
      </div>
      {model.web3Panel && (
        <Web3Dialog
          key={`${model.wallet?.address ?? 'disconnected'}:${model.web3Panel}`}
          model={model}
        />
      )}
      {action && (
        <ConfirmDialog
          action={action}
          market={model.markets.find((market) => market.name === action.coin)}
          onClose={() => setAction(null)}
          onConfirm={(skip, persist) =>
            model.confirmAction(action, skip, persist)
          }
        />
      )}
    </main>
  )
}
