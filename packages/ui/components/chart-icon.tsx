/** 图标路径来自 FameEX packages/icon/output/icon.json。 */
export function ChartIcon({
  name,
  className = 'size-5',
}: {
  name:
    | 'k-line-chart'
    | 'indicators'
    | 'refresh'
    | 'aspect-ratio-open2'
    | 'aspect-ratio-close2'
    | 'arrow-drop-down'
    | 'area'
  className?: string
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      className={className}
    >
      <use href={`/fameex-chart-icons.svg#${name}`} />
    </svg>
  )
}
