'use client'

import {
  Button,
  ChartIcon,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  dropdownStyle,
  Tab,
  Tabs,
} from '@fameex/ui'
import { cn } from '@fameex/utils'
import { type OrderKind, supportedOrderKinds } from '@/lib/order-ticket'
import type { Market } from '@/lib/orders'

const descriptions: Record<OrderKind, string> = {
  limit: '指定价格，按所选有效方式执行',
  market: '按当前盘口和滑点上限立即执行',
  'stop-market': '达到止损触发价后，以市价执行',
  'stop-limit': '达到止损触发价后，提交限价单',
  'take-market': '达到止盈触发价后，以市价执行',
  'take-limit': '达到止盈触发价后，提交限价单',
  scale: '在价格区间内分配多档限价单',
  twap: '由交易所按时段拆分执行大额订单',
  chase: '页面持续跟随最优报价，仅挂单',
  trailing: '由交易所跟踪价格，回撤后触发',
}

export function OrderTypeSelector({
  market,
  value,
  onChange,
}: {
  market: Market
  value: OrderKind
  onChange: (value: OrderKind) => void
}) {
  const options = supportedOrderKinds(market)
  const basic = value === 'limit' || value === 'market'
  const { menuStyle, itemStyle } = dropdownStyle()
  return (
    <div className="flex items-end justify-start gap-4 border-b border-edge">
      <Tabs
        aria-label="订单类型"
        selectedKey={basic ? value : 'advanced'}
        onSelectionChange={(key) => {
          if (key === 'limit' || key === 'market') onChange(key)
        }}
        classNames={{
          base: 'w-auto shrink-0',
          tabList: 'w-auto gap-4',
          cursor: 'w-full bg-text-1',
          tab: 'h-8 max-w-fit p-0 text-body-regular text-3',
          tabContent:
            'mb-1.5 font-medium text-3 group-data-[selected=true]:text-1',
        }}
      >
        <Tab key="limit" title="限价单" />
        <Tab key="market" title="市价单" />
      </Tabs>
      <Dropdown
        placement="bottom-start"
        offset={8}
        shouldCloseOnScroll={false}
        classNames={{
          content:
            'z-50 w-72 max-w-[calc(100vw-24px)] rounded-m border border-cc-1 bg-surface p-1 shadow-xl',
        }}
      >
        <DropdownTrigger>
          <Button
            aria-label="高级订单类型"
            variant="light"
            disableRipple
            className={cn(
              'group relative h-8 min-w-0 shrink-0 gap-1 rounded-none px-0 pb-1.5 text-sm font-medium !bg-transparent',
              basic
                ? 'text-muted hover:text-ink'
                : 'text-ink after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-ink',
            )}
          >
            {basic ? '专业' : options.find(([kind]) => kind === value)?.[1]}
            <ChartIcon
              name="arrow-drop-down"
              className="size-4 transition-transform group-aria-expanded:rotate-180"
            />
          </Button>
        </DropdownTrigger>
        <DropdownMenu
          aria-label="高级订单类型选项"
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={basic ? [] : [value]}
          onSelectionChange={(keys) => {
            const selected = options.find(
              ([key]) => keys !== 'all' && keys.has(key),
            )
            if (selected) onChange(selected[0])
          }}
          className={cn(
            menuStyle(),
            'max-h-[min(420px,60dvh)] overflow-y-auto overscroll-contain bg-surface p-0',
          )}
        >
          {options.slice(2).map(([key, label]) => (
            <DropdownItem
              key={key}
              textValue={label}
              description={descriptions[key]}
              className={cn(
                itemStyle(),
                'rounded-sm px-3 py-2.5 !text-ink data-[hover=true]:!bg-hover-n data-[focus=true]:!bg-hover-n data-[selected=true]:!text-accent',
              )}
              classNames={{
                title: 'text-sm font-medium',
                description:
                  'mt-1 whitespace-normal text-xs leading-4 text-muted',
              }}
            >
              {label}
            </DropdownItem>
          ))}
        </DropdownMenu>
      </Dropdown>
    </div>
  )
}
