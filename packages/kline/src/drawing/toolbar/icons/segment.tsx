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
        x1="11.0962"
        y1="2.05024"
        x2="1.55025"
        y2="11.5962"
        stroke="currentcolor"
        strokeWidth="0.5"
        strokeLinecap="round"
      />
      <circle
        cx="2.61086"
        cy="10.8891"
        r="1.25"
        transform="rotate(135 2.61086 10.8891)"
        fill="white"
        stroke="currentcolor"
        strokeWidth="0.5"
      />
      <circle
        cx="10.3891"
        cy="3.1109"
        r="1.25"
        transform="rotate(135 10.3891 3.1109)"
        fill="white"
        stroke="currentcolor"
        strokeWidth="0.5"
      />
    </svg>
  )
}
