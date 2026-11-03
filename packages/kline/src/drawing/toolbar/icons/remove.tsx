export default function Icon({ className }: { className?: string }) {
  const resolvedClassName = className
    ? `icon-overlay ${className}`
    : 'icon-overlay'
  return (
    <svg
      aria-hidden="true"
      className={resolvedClassName}
      width="20"
      height="20"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M9.17384 11.9067H5.19947C4.30203 11.9067 3.5328 11.1448 3.5328 10.1924V4.4781H3.98153V10.1924C3.98153 10.8908 4.55845 11.4622 5.19947 11.4622H9.17384C9.81486 11.4622 10.3918 10.8908 10.3918 10.1924V4.4781H10.8405V10.1924C10.8405 11.1448 10.0713 11.9067 9.17384 11.9067ZM2.18665 3.90667H12.1866V4.4781H2.18665V3.90667Z"
        fill="currentcolor"
      />
      <path
        d="M5.4625 6.19935H6.01423V9.90667H5.4625V6.19935ZM6.91078 6.19935H7.46251V9.90667H6.91078V6.19935ZM8.35906 6.19935H8.91079V9.90667H8.35906V6.19935ZM9.18665 3.98798H8.70389C8.70389 3.0774 8.01422 2.36195 7.18664 2.36195C6.35905 2.36195 5.6694 3.0774 5.6694 3.98798H5.18665C5.18665 2.88228 6.08319 1.90667 7.18664 1.90667C8.2901 1.90667 9.18665 2.81725 9.18665 3.98798Z"
        fill="currentcolor"
      />
    </svg>
  )
}
