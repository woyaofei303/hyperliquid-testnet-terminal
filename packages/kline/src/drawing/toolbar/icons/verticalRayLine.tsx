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
        x1="6.25"
        y1="0.25"
        x2="6.25"
        y2="13.75"
        stroke="currentcolor"
        strokeWidth="0.5"
        strokeLinecap="round"
      />
      <circle
        cx="6.5"
        cy="12.5"
        r="1.25"
        transform="rotate(90 6.5 12.5)"
        fill="white"
        stroke="currentcolor"
        strokeWidth="0.5"
      />
      <circle
        cx="6.5"
        cy="5.5"
        r="1.25"
        transform="rotate(90 6.5 5.5)"
        fill="white"
        stroke="currentcolor"
        strokeWidth="0.5"
      />
    </svg>
  )
}
