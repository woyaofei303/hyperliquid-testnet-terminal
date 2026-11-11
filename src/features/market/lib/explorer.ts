export function transactionUrl(hash: string | undefined) {
  return hash && /^0x[0-9a-fA-F]{64}$/.test(hash) && !/^0x0{64}$/.test(hash)
    ? `https://app.hyperliquid-testnet.xyz/explorer/tx/${hash}`
    : null
}
