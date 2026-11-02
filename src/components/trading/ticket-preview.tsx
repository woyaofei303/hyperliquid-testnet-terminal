import { t, useLocale } from '@/i18n'
import { baseName, isCash, quoteName } from '@/lib/market-catalog'
import type { Ticket } from '@/lib/order-ticket'

export function TicketPreview({ ticket }: { ticket: Ticket }) {
  useLocale()

  if (ticket.kind === 'orders')
    return (
      <>
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-right text-xs">
            <thead className="text-muted">
              <tr>
                <th className="py-2 text-left">{t('类型 / 方向')}</th>
                <th>{t('数量')}</th>
                <th>{t('委托 / 触发价')}</th>
              </tr>
            </thead>
            <tbody>
              {ticket.orders.map((order, index) => (
                <tr
                  key={`${index}-${order.p}`}
                  className="border-t border-edge"
                >
                  <td className="py-2 text-left">
                    {'limit' in order.t
                      ? order.t.limit.tif
                      : `${order.t.trigger.tpsl.toUpperCase()} ${t(order.t.trigger.isMarket ? '市价' : '限价')}`}{' '}
                    · {order.b ? t('买') : t('卖')}
                    {order.r && ` · ${t('只减仓')}`}
                  </td>
                  <td className="font-mono">{order.s}</td>
                  <td className="font-mono">
                    {order.p}
                    {'trigger' in order.t && (
                      <span className="block text-muted">
                        {t('触发')} {order.t.trigger.triggerPx}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {ticket.grouping === 'positionTpsl' && (
          <p className="text-xs text-muted">
            {t(
              '仅保护此次确认的仓位数量；两侧均为只减仓。请在当前委托核对既有保护单，避免重复设置。',
            )}
          </p>
        )}
        {ticket.grouping === 'normalTpsl' && (
          <p className="text-xs leading-5 text-muted">
            {t(
              '附带 TP/SL 随父单激活；未完全成交的父单被取消时，保护单可能一并取消。请在仓位区核对保护状态。',
            )}
          </p>
        )}
      </>
    )
  if (ticket.kind === 'twap')
    return (
      <div className="space-y-2 text-sm">
        <p>
          {ticket.action.twap.b ? t('买入') : t('卖出')} {ticket.size}{' '}
          {baseName(ticket.market)} · {ticket.action.twap.m} {t('分钟')}
        </p>
        <p>
          {t('随机执行：')}
          {ticket.action.twap.t ? t('开启') : t('关闭')}
          {!isCash(ticket.market) &&
            `${t('；只减仓：')}${t(ticket.action.twap.r ? '是' : '否')}`}
        </p>
        {ticket.action.details?.t && (
          <p>
            {t('标记价')}
            {ticket.action.details.t.a ? t('高于') : t('低于')}{' '}
            {ticket.action.details.t.p} {t('激活')}
          </p>
        )}
        {ticket.action.details?.s && (
          <p>
            {ticket.action.twap.b ? t('最高成交价') : t('最低成交价')}：
            {ticket.action.details.s}
          </p>
        )}
        <p className="text-xs leading-5 text-muted">
          {t(
            '由交易所持续执行，关闭页面不停止；子单滑点上限 3%，低流动性时可能无法完成全部数量。',
          )}
        </p>
      </div>
    )
  if (ticket.kind === 'trailing')
    return (
      <div className="space-y-2 text-sm">
        <p>
          {ticket.action.isBuy ? t('买入') : t('卖出')} {ticket.size}{' '}
          {baseName(ticket.market)}
          {ticket.action.reduceOnly && ` · ${t('只减仓')}`}
        </p>
        <p>
          {t('回撤：')}
          {'pct' in ticket.action.retracement
            ? ticket.action.retracement.pct
            : `${ticket.action.retracement.px} ${quoteName(ticket.market)}`}
        </p>
        <p>
          {t('激活价格：')}
          {ticket.action.activationPx ?? t('立即开始跟踪')}
        </p>
        <p className="text-xs leading-5 text-muted">
          {t(
            '交易所跟踪标记价，回撤达到条件后触发市价单。关闭页面不停止，跳空可能导致成交价格偏离触发价。',
          )}
        </p>
      </div>
    )
  return (
    <div className="space-y-2 text-sm">
      <p>
        {ticket.order.b ? t('买入') : t('卖出')} {ticket.size}{' '}
        {baseName(ticket.market)}
      </p>
      <p>
        {ticket.order.b ? t('最高买入价') : t('最低卖出价')}：{ticket.order.p}
      </p>
      <p className="text-xs leading-5 text-muted">
        {t(
          '授权当前页面在数量与限价范围内持续调整 Post-only 报价，最多同时运行 5 笔追价。可在策略列表停止；刷新、断开或关闭后停止改价，但已挂订单仍可能成交，请核对并撤销。',
        )}
      </p>
    </div>
  )
}
