export default function Icon({ className }: { className?: string }) {
  const resolvedClassName = className
    ? `icon-overlay ${className}`
    : 'icon-overlay'
  return (
    <svg
      aria-hidden="true"
      className={resolvedClassName}
      width="14"
      height="15"
      viewBox="0 0 14 15"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M6.29289 5.4662C6.48043 5.2688 6.73478 5.15789 7 5.15789C7.26522 5.15789 7.51957 5.2688 7.70711 5.4662C7.89464 5.66361 8 5.93135 8 6.21053V12H11V6.21053C11 3.88632 9.208 2 7 2C4.792 2 3 3.88632 3 6.21053V12H6V6.21053C6 5.93135 6.10536 5.66361 6.29289 5.4662ZM5.93934 5.09404C5.65804 5.39015 5.5 5.79176 5.5 6.21053V9.36902H3.5V6.21053C3.5 4.17684 5.068 2.52632 7 2.52632C8.932 2.52632 10.5 4.17684 10.5 6.21053V9.36902H8.5V6.21053C8.5 5.79176 8.34196 5.39015 8.06066 5.09404C7.77936 4.79793 7.39782 4.63158 7 4.63158C6.60218 4.63158 6.22064 4.79793 5.93934 5.09404ZM8.5 9.89534V11.4737H10.5V9.89534H8.5ZM3.5 9.89534V11.4737H5.5V9.89534H3.5Z"
        fill="currentcolor"
      />
      <path
        d="M4.5 13L5 13.5L4 13.75L5 14.5"
        stroke="currentcolor"
        strokeWidth="0.5"
        strokeLinecap="square"
      />
      <path
        d="M9.5 13L9 13.5L10 13.75L9 14.5"
        stroke="currentcolor"
        strokeWidth="0.5"
        strokeLinecap="square"
      />
    </svg>
  )
}
