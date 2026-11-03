export default function CrossCursorIcon({ className }: { className?: string }) {
  const resolvedClassName = className
    ? `icon-overlay ${className}`
    : 'icon-overlay'
  return (
    <svg
      aria-hidden="true"
      width="15"
      height="15"
      viewBox="0 0 15 15"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={resolvedClassName}
    >
      <path
        d="M7.07143 14.7857V9.64286H7.71429V14.7857H7.07143Z"
        fill="currentcolor"
      />
      <path
        d="M7.07143 5.14286V0H7.71429V5.14286H7.07143Z"
        fill="currentcolor"
      />
      <path
        d="M5.14286 7.71428H0V7.07143H5.14286V7.71428Z"
        fill="currentcolor"
      />
      <path
        d="M14.7845 7.71415H9.6416V7.07129H14.7845V7.71415Z"
        fill="currentcolor"
      />
    </svg>
  )
}
