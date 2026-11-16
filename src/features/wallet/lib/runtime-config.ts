export interface PublicRuntimeConfig {
  schemaVersion: 1
  phonePairingEnabled: boolean
}

export function pairingOrigin(value: unknown, origin: string): string {
  if (
    !value ||
    typeof value !== 'object' ||
    !('schemaVersion' in value) ||
    value.schemaVersion !== 1 ||
    !('phonePairingEnabled' in value) ||
    value.phonePairingEnabled !== true
  )
    throw new Error('手机配对服务暂不可用，请稍后重试。')
  const url = new URL(origin)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (
    url.username ||
    url.password ||
    url.origin !== origin ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
  )
    throw new Error('手机配对服务必须使用本站 HTTPS 地址')
  return url.origin
}

export async function loadPairingOrigin(origin: string): Promise<string> {
  const response = await fetch(`${origin}/runtime-config.json`, {
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) throw new Error('手机配对配置读取失败')
  return pairingOrigin(await response.json(), origin)
}
