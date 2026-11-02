'use client'

import { memo, useId } from 'react'

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
  custom?: boolean
}

const CustomSpinner = memo(
  ({
    size = 'md',
    className,
  }: {
    size?: 'sm' | 'md' | 'lg'
    className?: string
  }) => {
    const sizeConfig = {
      sm: {
        className: 'size-5',
        viewBox: 20,
        center: 10,
        radius: 7,
        strokeWidth: 2,
      },
      md: {
        className: 'size-6',
        viewBox: 24,
        center: 12,
        radius: 9,
        strokeWidth: 2.5,
      },
      lg: {
        className: 'size-10',
        viewBox: 40,
        center: 20,
        radius: 16,
        strokeWidth: 4,
      },
    }
    // Multiple spinners on one page: unique gradient id so SVG url() refs do not collide.
    const id = useId()
    const gradientId = `spinner-gradient-${size}-${id.replace(/:/g, '')}`
    const config = sizeConfig[size]
    const circumference = 2 * Math.PI * config.radius
    const dashArray = circumference * 0.6

    return (
      <svg
        aria-hidden="true"
        className={`inline-block animate-spin will-change-transform ${config.className} ${className || ''}`}
        viewBox={`0 0 ${config.viewBox} ${config.viewBox}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#8B5CF6" stopOpacity={1} />
            <stop offset="25%" stopColor="#8B5CF6" stopOpacity={0.8} />
            <stop offset="60%" stopColor="#8B5CF6" stopOpacity={0.3} />
            <stop offset="85%" stopColor="#8B5CF6" stopOpacity={0.08} />
            <stop offset="100%" stopColor="transparent" stopOpacity={0} />
          </linearGradient>
        </defs>
        {/* 底部灰色圆环 */}
        <circle
          cx={config.center}
          cy={config.center}
          r={config.radius}
          stroke="#0B0C0E"
          strokeOpacity={0.04}
          strokeWidth={config.strokeWidth}
          fill="none"
        />
        {/* 紫色旋转圆环  */}
        <circle
          cx={config.center}
          cy={config.center}
          r={config.radius}
          stroke={`url(#${gradientId})`}
          strokeWidth={config.strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${dashArray} ${circumference}`}
          strokeDashoffset={dashArray * 0.25}
          transform={`rotate(-90 ${config.center} ${config.center})`}
        />
      </svg>
    )
  },
)

export const Spinner = function SpinnerImpl({
  size = 'md',
  className,
}: SpinnerProps) {
  return <CustomSpinner size={size} className={className} />
}

Spinner.displayName = 'Spinner'
