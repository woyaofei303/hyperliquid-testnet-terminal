'use client'
import { Tooltip } from '@fameex/ui'
import { t, useLocale } from '@/i18n'

const help: Record<string, [string, string]> = {
  '阶梯档数（2–50）': [
    '把总数量分配到指定价格区间的多笔限价订单，各档仍受精度和最小金额约束。',
    'Splits total size into limit orders across the price range. Each level must satisfy precision and minimum notional.',
  ],
  数量分配: [
    '控制阶梯单在各价格档位的数量权重，总数量保持不变。',
    'Controls size weights across scale-order prices while preserving total size.',
  ],
  '执行时长（分钟，5–10080）': [
    '交易所在此时段内分批执行 TWAP；流动性不足时可能无法全部成交。',
    'The exchange executes TWAP slices over this duration; insufficient liquidity may prevent full execution.',
  ],
  随机执行: [
    '让 TWAP 子单执行节奏随机变化，避免完全固定的时间间隔。',
    'Randomizes TWAP slice timing instead of using perfectly regular intervals.',
  ],
  'TWAP 触发价（可选）': [
    '在标记价格达到指定方向的触发条件后才开始 TWAP。留空表示立即开始。',
    'Starts TWAP when the mark meets the selected trigger direction. Leave empty to start immediately.',
  ],
  '激活价格（可选）': [
    '标记价格到达后才开始跟踪；留空立即开始跟踪最有利价格。',
    'Starts tracking when the mark reaches this level. Leave empty to track immediately.',
  ],

  价格: [
    '限价单允许的最差成交价格；买单不会高于此价，卖单不会低于此价。',
    'Worst allowed limit price: buys never execute above it and sells never execute below it.',
  ],
  触发价格: [
    '合约按标记价格判断触发条件，触发后提交对应市价或限价委托。',
    'Perpetual orders trigger on mark price and then submit the selected market or limit order.',
  ],
  最高价格: [
    '阶梯单价格区间的上界，必须高于最低价格。',
    'Upper boundary of scale orders; it must exceed the lowest price.',
  ],
  最低价格: [
    '阶梯单价格区间的下界，各档委托在区间内分配。',
    'Lower boundary of scale orders; order levels are distributed within the range.',
  ],
  追价边界: [
    '追价单跟随最优报价，但不会超过指定买入上限或卖出下限。',
    'Chase orders follow the best quote without crossing the buy cap or sell floor.',
  ],
  'TWAP 价格边界': [
    '限制 TWAP 子单的成交价格；行情超出边界时可能无法完成总数量。',
    'Limits TWAP slice prices. The full quantity may not execute if the market moves beyond this boundary.',
  ],
  可用: [
    '当前方向可用于交易的资产余额，已扣除冻结与占用。',
    'Asset balance available for this side, after holds and other requirements.',
  ],
  标记价格: [
    '用于计算未实现盈亏和触发清算、止盈止损的参考价格，可能不同于最新成交价。',
    'Reference price for unrealized PnL, liquidation and TP/SL triggers; it can differ from the last trade.',
  ],
  预言机价格: [
    '验证者汇总的外部现货参考价格。',
    'External spot reference price aggregated by validators.',
  ],
  '24h 涨跌': [
    '当前价格相对 24 小时前价格的变化，不是按本地零点计算。',
    'Change from the price 24 hours ago, not local midnight.',
  ],
  '24h 成交额': [
    '过去 24 小时成交的名义金额，以报价资产计价。',
    'Traded notional over the last 24 hours, in the quote asset.',
  ],
  持仓量: [
    '尚未平仓的合约数量，按标记价格折算为名义金额。',
    'Outstanding contract positions valued at the mark price.',
  ],
  '资金费率 / 倒计时': [
    '每小时结算；正费率由多方支付空方，负费率相反。倒计时为下一次结算时间。',
    'Settled hourly. Positive funding is paid by longs to shorts; negative funding reverses this. The timer shows the next settlement.',
  ],
  可用保证金: [
    '交易所返回的可用交易余额，已考虑当前账户类型与仓位占用。',
    'Available trading balance returned by the exchange, accounting for account mode and position requirements.',
  ],
  当前仓位: [
    '当前市场已成交的持仓数量，不包括未成交委托。',
    'Filled position in this market, excluding open orders.',
  ],
  仓位数量: [
    '当前持仓的基础资产数量；多头与空头以不同颜色显示。',
    'Position size in the base asset. Long and short positions use different colors.',
  ],
  仓位价值: [
    '仓位数量的绝对值乘以当前标记价格。',
    'Absolute position size multiplied by the mark price.',
  ],
  开仓均价: [
    '当前未平仓部分的平均入场价格。',
    'Average entry price of the open position.',
  ],
  '盈亏 / 收益率': [
    '未实现盈亏及交易所返回的保证金收益率（ROE），未计入最终平仓手续费。',
    'Unrealized PnL and exchange-reported return on equity (ROE), before final closing fees.',
  ],
  预估清算价: [
    '交易所估算的清算触发价格，随保证金、资金费和其他仓位变化，并非保证成交价。',
    'Exchange-estimated liquidation trigger, affected by margin, funding and other positions. It is not a guaranteed execution price.',
  ],
  保证金: [
    '分配给仓位或由全仓账户共享的保证金；全仓与逐仓的风险范围不同。',
    'Margin allocated to the position or shared by cross positions. Cross and isolated modes have different risk scopes.',
  ],
  资金费: [
    '自开仓以来累计资金费：正数表示已支付，负数表示已收取。',
    'Cumulative funding since opening: positive means paid, negative means received.',
  ],
  平仓: [
    '使用反向只减仓订单减少现有仓位，不能因此开立反向仓位。',
    'Reduce the existing position with an opposite reduce-only order; it cannot open a reverse position.',
  ],
  反手: [
    '按当前仓位的两倍数量发出反向市价单，先平仓再开立等量反向仓位；部分成交可能无法达到目标。',
    'Submit an opposite market order for twice the current size to close and reverse. Partial fills may not reach the target position.',
  ],
  '止盈 / 止损': [
    '按标记价格触发。市价触发不保证成交价格，限价触发可能无法全部成交。',
    'Triggered by the mark price. Market execution has no guaranteed price; limit execution may remain unfilled.',
  ],
  '只减仓 Reduce-only': [
    '仅减少已有反向仓位，不能增加仓位或反向开仓。没有可减仓位时不能提交。',
    'Only reduces an existing opposite position. It cannot increase exposure or reverse a position.',
  ],
  订单有效方式: [
    'GTC 持续有效直至撤销；IOC 立即成交并取消剩余；Post-only 只挂单，可能立即成交时拒绝。',
    'GTC remains until cancelled. IOC cancels the unfilled remainder. Post-only rejects an order that would immediately take liquidity.',
  ],
  最大可下: [
    '基于交易所可用交易数量估算；受方向、杠杆、保证金与其他订单影响，最终以交易所校验为准。',
    'Estimated from the exchange-provided trading capacity. Direction, leverage, margin and orders may change the final allowed size.',
  ],
  可减仓数量: [
    '当前方向可关闭的持仓数量上限。',
    'Maximum position size that this order direction can reduce.',
  ],
  订单价值: [
    '订单数量乘以参考价格，市价单实际金额以成交结果为准。',
    'Size times reference price. Actual market order value depends on execution.',
  ],
  订单金额: [
    '基础资产数量乘以订单价格；报价资产输入会按市场精度换算数量。',
    'Base quantity times order price. Quote-asset input is converted using market size precision.',
  ],
  预计初始保证金: [
    '按订单名义金额与当前杠杆估算，不包含后续浮动盈亏和资金费。',
    'Estimated notional divided by leverage, excluding subsequent PnL and funding.',
  ],
  预计手续费: [
    '按当前账户费率估算；成交角色、实际成交数量与价格决定最终费用。',
    'Estimated from account fee rates. Maker/taker role, filled size and execution price determine actual fees.',
  ],
  预计手续费上限: [
    '按预估订单金额和账户费率计算，实际扣费以交易所成交回报为准。',
    'Estimated from order value and account fee rates; actual fees come from exchange fills.',
  ],
  最大滑点: [
    '市价单允许的最差成交价格边界；超出边界的剩余数量取消，不保证全部成交。',
    'Worst allowed price boundary for a market order. Unfilled size outside the boundary is cancelled.',
  ],
  账户权益: [
    '账户余额加未实现盈亏；不等同于可提现金额。',
    'Account balance plus unrealized PnL; this is not the withdrawable amount.',
  ],
  已用保证金: [
    '交易所返回的仓位保证金占用总额。',
    'Total position margin usage reported by the exchange.',
  ],
  可提余额: [
    '交易所允许提取的余额，已扣除仓位、委托等占用，提款费用另计。',
    'Balance available to withdraw after exchange holds; withdrawal fees are separate.',
  ],
  结算资产余额: [
    '统一账户中该结算资产的总余额，包含已占用部分。',
    'Total settlement-asset balance in the unified account, including held funds.',
  ],
  已占用: [
    '被委托或交易风险要求占用、暂不可自由使用的余额。',
    'Funds held for open orders or trading risk requirements.',
  ],
  账户类型: [
    '经典账户区分现货与合约余额；统一账户共享资产；投资组合保证金另受交易所资格与风险规则约束。',
    'Standard separates spot and perp balances. Unified shares assets. Portfolio margin has additional exchange eligibility and risk rules.',
  ],
  连接状态: [
    '钱包连接、账户余额核验和交易连接是不同状态；交易连接用于本浏览器代签交易。',
    'Wallet connection, account verification and trading session are separate states. The trading session signs orders in this browser.',
  ],
  '现货 USDC 余额': [
    '现货账户持有的 USDC 总额，包含冻结部分。',
    'Total spot USDC balance, including held funds.',
  ],
  报价资产: [
    '当前交易对中可用于买入的报价资产可用余额。',
    'Available quote-asset balance for buying the selected market.',
  ],
  持有数量: [
    '当前基础资产的可用数量，已扣除冻结部分。',
    'Available base-asset quantity after holds.',
  ],
  冻结数量: [
    '已被未成交委托占用的资产数量。',
    'Asset quantity held by open orders.',
  ],
  平仓价格: [
    '只减仓限价单的委托价格，未达到该价格可能无法成交。',
    'Limit price of the reduce-only order. It may remain unfilled if the market does not reach this price.',
  ],
  止盈价格: [
    '标记价格达到该价格时触发止盈，价格相对入场价与方向决定预期收益。',
    'Take profit triggers when the mark reaches this price. Expected profit depends on entry price and direction.',
  ],
  止损价格: [
    '标记价格达到该价格时触发止损；跳空或流动性不足可能导致成交偏离。',
    'Stop loss triggers when the mark reaches this price. Gaps or limited liquidity can cause execution slippage.',
  ],
  收益: [
    '百分比是考虑杠杆的保证金收益率（ROE）；金额按数量与入场价估算，未扣手续费和资金费。',
    'Percentage is leveraged ROE. Amount is estimated from size and entry, before fees and funding.',
  ],
  亏损: [
    '输入正数表示预期亏损；百分比为 ROE，金额未包含手续费和资金费。',
    'Enter a positive loss magnitude. Percentage is ROE; amount excludes fees and funding.',
  ],
  回撤距离: [
    '跟踪最有利标记价格：多头从高点回落、空头从低点反弹达到距离后触发。',
    'Tracks the most favorable mark: a fall from a long’s peak or a rise from a short’s trough triggers at this distance.',
  ],
  激活价格: [
    '可选的开始跟踪价格；未设置时立即跟踪，有设置时先等待标记价到达。',
    'Optional price at which tracking starts. Without it, tracking begins immediately.',
  ],
  价差: [
    '最优卖价减最优买价；百分比以盘口中间价计算。',
    'Best ask minus best bid; percentage is relative to the midpoint.',
  ],
  数量: [
    '该档位的挂单数量，单位由当前列标题决定。',
    'Resting quantity at this price level, in the column’s displayed unit.',
  ],
  合计: [
    '从最优档位到当前档位的累计数量，只累计同一买卖方向。',
    'Cumulative quantity from the best price through this level, on the same side only.',
  ],
  市场价格: [
    '交易所返回的当前市场参考价格，可能与最后一笔成交不同。',
    'Current market reference price returned by the exchange; it may differ from the latest fill.',
  ],
  配置金额: [
    '默认保护触发时的全部仓位；开启后仅保护指定固定数量，不随加仓增长。',
    'Default covers the entire position at trigger time. When enabled, protection uses a fixed size and does not grow with the position.',
  ],
  限价保护: [
    '触发后提交指定价格的只减仓限价单；行情越过限价时可能留在委托簿。',
    'Submits a reduce-only limit order on trigger. It can remain resting when the market moves beyond the limit.',
  ],
  下单确认: [
    '开启后，下单前显示订单摘要；关闭后点击下单直接提交。',
    'Show an order summary before submitting. When off, the order button submits immediately.',
  ],
  平仓确认: [
    '控制市价平仓和反手确认；限价和移动止损仍需填写参数。',
    'Controls market-close and reverse confirmations. Limit close and trailing stop still require parameters.',
  ],
}
export function HelpLabel({
  label,
  description,
  helpKey,
}: {
  label: string
  description?: string
  helpKey?: string
}) {
  const locale = useLocale()
  const entry =
    help[helpKey ?? label] ??
    Object.entries(help).find(([key]) => t(key) === label)?.[1]
  const content = description ?? entry?.[locale === 'en-US' ? 1 : 0]
  if (!content) return <>{t(label)}</>
  return (
    <Tooltip content={content}>
      <dfn
        // biome-ignore lint/a11y/noNoninteractiveTabindex: 定义提示必须可通过键盘聚焦阅读。
        tabIndex={0}
        className="not-italic cursor-help underline decoration-muted/40 decoration-dotted underline-offset-4 focus-visible:rounded-sm focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
      >
        {t(label)}
      </dfn>
    </Tooltip>
  )
}
