export function display(value: string | number | null | undefined, digits = 2) {
  if (value == null || value === '') return '—'
  const n = Number(value)
  return Number.isFinite(n)
    ? n.toLocaleString('en-US', {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      })
    : '—'
}
