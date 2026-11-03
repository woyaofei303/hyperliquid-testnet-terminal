import type { ComponentType } from 'react'

interface IconProps {
  className?: string
}

/**
 * Take Profit / Stop Loss icon
 * Represents a horizontal line with TP/SL markers
 */
const TakeProfitStopLoss: ComponentType<IconProps> = ({ className }) => (
  <svg
    aria-hidden="true"
    className={className}
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Main entry line */}
    <line
      x1="4"
      y1="16"
      x2="28"
      y2="16"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    {/* Take profit line (upper) */}
    <line
      x1="4"
      y1="10"
      x2="28"
      y2="10"
      stroke="currentColor"
      strokeWidth="1"
      strokeDasharray="3 2"
      strokeLinecap="round"
      opacity="0.6"
    />
    {/* Stop loss line (lower) */}
    <line
      x1="4"
      y1="22"
      x2="28"
      y2="22"
      stroke="currentColor"
      strokeWidth="1"
      strokeDasharray="3 2"
      strokeLinecap="round"
      opacity="0.6"
    />
    {/* Entry marker */}
    <rect
      x="6"
      y="13"
      width="8"
      height="6"
      rx="1"
      fill="currentColor"
      opacity="0.3"
    />
    {/* TP marker */}
    <circle cx="24" cy="10" r="2" fill="currentColor" opacity="0.5" />
    {/* SL marker */}
    <circle cx="24" cy="22" r="2" fill="currentColor" opacity="0.5" />
    {/* Arrows indicating adjustable range */}
    <path
      d="M3 13L3 10M3 10L5 12M3 10L1 12"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity="0.4"
    />
    <path
      d="M3 19L3 22M3 22L5 20M3 22L1 20"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity="0.4"
    />
  </svg>
)

export default TakeProfitStopLoss
