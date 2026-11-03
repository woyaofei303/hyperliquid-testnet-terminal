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
      <path
        d="M7.75 6.5C7.75 7.19036 7.19036 7.75 6.5 7.75C5.80964 7.75 5.25 7.19036 5.25 6.5C5.25 5.80964 5.80964 5.25 6.5 5.25C7.19036 5.25 7.75 5.80964 7.75 6.5Z"
        fill="white"
        stroke="currentcolor"
        strokeWidth="0.5"
      />
    </svg>
  )
}
