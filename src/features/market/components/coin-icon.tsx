import Image from 'next/image'
import { useState } from 'react'

export function CoinIcon({
  coin,
  className = 'size-5',
}: {
  coin: string
  className?: string
}) {
  const [failed, setFailed] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<string | null>(null)
  const symbol = coin.replace(/^k(?=[A-Z])/, '')
  return (
    <span
      aria-hidden="true"
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent/10 text-xs font-semibold text-accent ${className}`}
    >
      {(!coin || loaded !== coin || failed === coin) &&
        (symbol.slice(0, 1) || '?')}
      {coin && failed !== coin && (
        <Image
          src={`https://app.hyperliquid.xyz/coins/${encodeURIComponent(symbol)}.svg`}
          width={28}
          height={28}
          unoptimized
          alt=""
          className={`absolute inset-0 size-full object-contain ${loaded === coin ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setLoaded(coin)}
          onError={() => setFailed(coin)}
        />
      )}
    </span>
  )
}
