export default function CursorIcon({ className }: { className?: string }) {
  const resolvedClassName = className
    ? `icon-overlay ${className}`
    : 'icon-overlay'
  return (
    <svg
      aria-hidden="true"
      className={resolvedClassName}
      width="12"
      height="13"
      viewBox="0 0 12 13"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M1.08179 0.938721L10.0818 5.89673L10.6658 6.21899L10.0378 6.44263L7.07983 7.49536L9.17749 10.1848L9.36206 10.4211L9.12573 10.6057L8.06323 11.4377L7.8269 11.6233L7.64136 11.386L5.54565 8.69653L3.81128 11.3176L3.44116 11.8752L3.27124 11.2278L0.647217 1.27759L0.468506 0.60083L1.08179 0.938721Z"
        stroke="currentcolor"
        strokeWidth="0.6"
      />
    </svg>
  )
}
