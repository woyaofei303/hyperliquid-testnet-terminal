export const accountTypes = [
  {
    value: 'unifiedAccount',
    label: '统一',
    name: '统一账户',
    description:
      '同一种资产的现货与合约共用余额；使用相同抵押资产的全仓仓位共享保证金。不同抵押资产之间不合并。',
  },
  {
    value: 'portfolioMargin',
    label: '组合',
    name: '投资组合保证金',
    description:
      '现货与合约共同计算保证金。符合条件的资产可作为抵押品，借入资产开仓可能产生利息，清算风险按组合计算。',
  },
  {
    value: 'disabled',
    label: '手动',
    name: '手动',
    description:
      '现货、合约及各 DEX 分别管理余额，全仓保证金仅在各自 DEX 内共享。适合需要独立管理资金的自动化交易。',
  },
] as const
export type AccountType = (typeof accountTypes)[number]['value']
export type AccountMode = AccountType | 'default' | 'dexAbstraction'

export function parseAccountMode(value: unknown): AccountMode {
  if (
    value === 'default' ||
    value === 'dexAbstraction' ||
    value === 'disabled' ||
    value === 'unifiedAccount' ||
    value === 'portfolioMargin'
  )
    return value
  throw new Error('账户类型无法识别，请刷新查询')
}

export function accountTypeName(mode: AccountMode | null | undefined) {
  if (!mode) return '—'
  if (mode === 'default') return '默认'
  if (mode === 'dexAbstraction') return '旧版 DEX 模式'
  return accountTypes.find((type) => type.value === mode)?.name ?? '未知类型'
}

export const sharedAccount = (mode: AccountMode | undefined) =>
  mode === 'unifiedAccount' || mode === 'portfolioMargin'
