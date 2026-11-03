export default function Icon({ className }: { className?: string }) {
  const resolvedClassName = className
    ? `icon-overlay ${className}`
    : 'icon-overlay'
  return (
    <svg
      aria-hidden="true"
      className={resolvedClassName}
      width="13"
      height="13"
      viewBox="0 0 13 13"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <line
        x1="10.6066"
        y1="1.0607"
        x2="1.0607"
        y2="10.6066"
        stroke="currentcolor"
        strokeWidth="0.5"
        strokeLinecap="round"
      />
      <circle
        cx="3.12131"
        cy="8.89953"
        r="1.25"
        transform="rotate(135 3.12131 8.89953)"
        fill="white"
        stroke="currentcolor"
        strokeWidth="0.5"
      />
      <circle
        cx="8.89951"
        cy="3.12134"
        r="1.25"
        transform="rotate(135 8.89951 3.12134)"
        fill="white"
        stroke="currentcolor"
        strokeWidth="0.5"
      />
    </svg>
  )
}
