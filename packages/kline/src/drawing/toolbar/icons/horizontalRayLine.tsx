export default function Icon({ className }: { className?: string }) {
  const resolvedClassName = className
    ? `icon-overlay ${className}`
    : 'icon-overlay'
  return (
    <svg
      aria-hidden="true"
      className={resolvedClassName}
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <line
        x1="0.25"
        y1="6.75"
        x2="13.75"
        y2="6.75"
        stroke="currentcolor"
        strokeWidth="0.5"
        strokeLinecap="round"
      />
      <circle
        cx="8.5"
        cy="6.5"
        r="1.25"
        fill="white"
        stroke="currentcolor"
        strokeWidth="0.5"
      />
      <circle
        cx="1.5"
        cy="6.5"
        r="1.25"
        fill="white"
        stroke="currentcolor"
        strokeWidth="0.5"
      />
    </svg>
  )
}
