// 仅创建短时合成密文，不连接钱包、交易所，也不输出会话凭据。
import assert from 'node:assert/strict'

const base = process.argv[2]
assert.ok(
  ['http://127.0.0.1:3211', 'https://staging-app.fameex-testnet.xyz'].includes(
    base,
  ),
  '只允许容器内环回地址或预发布域名',
)
let checks = 0
async function request(
  path,
  status,
  method = 'GET',
  token,
  body,
  origin = 'https://staging-app.fameex-testnet.xyz',
) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5000),
    redirect: 'error',
  })
  assert.equal(response.status, status, `${method} 配对请求状态不符`)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  checks++
  return response.json()
}

async function main() {
  await request(
    '/pairings',
    403,
    'POST',
    undefined,
    undefined,
    'https://app.fameex-testnet.xyz',
  )
  const session = await request('/pairings', 200, 'POST')
  assert.match(session.id, /^[a-f0-9]{32}$/)
  assert.ok(/^[a-f0-9]{64}$/.test(session.webToken), 'Web 令牌格式无效')
  assert.ok(/^[a-f0-9]{64}$/.test(session.phoneToken), '手机令牌格式无效')
  assert.ok(session.webToken !== session.phoneToken, '两端令牌不能相同')
  // 与 v1 协议一致：跨设备时钟最多允许快 30 秒，不延长已过期会话。
  assert.ok(
    session.expiresAt > Date.now() && session.expiresAt <= Date.now() + 330000,
  )
  const path = `/pairings/${session.id}`
  try {
    await request(path, 401)
    await request(`${path}/approval`, 409, 'POST', session.webToken, {
      envelope: 'ab'.repeat(28),
    })
    await request(`${path}/request`, 401, 'POST', session.webToken, {
      envelope: 'ab'.repeat(28),
    })
    await request(`${path}/request`, 400, 'POST', session.phoneToken, {
      envelope: 'invalid',
    })
    const envelope = 'ab'.repeat(28)
    await request(`${path}/request`, 200, 'POST', session.phoneToken, {
      envelope,
    })
    await request(`${path}/request`, 200, 'POST', session.phoneToken, {
      envelope,
    })
    await request(`${path}/request`, 409, 'POST', session.phoneToken, {
      envelope: 'cd'.repeat(28),
    })
    assert.equal(
      (await request(path, 200, 'GET', session.webToken)).request,
      envelope,
    )
    await request(`${path}/approval`, 401, 'POST', session.phoneToken, {
      envelope,
    })
    await request(`${path}/approval`, 200, 'POST', session.webToken, {
      envelope,
    })
    assert.equal(
      (await request(path, 200, 'GET', session.phoneToken)).approval,
      envelope,
    )
  } finally {
    await request(path, 200, 'DELETE', session.webToken)
  }
  await request(path, 410, 'GET', session.webToken)
  console.log(
    JSON.stringify({
      checks,
      syntheticOnly: true,
      walletActions: 0,
      sessionRemoved: true,
    }),
  )
}

void main().catch(() => {
  console.error(
    JSON.stringify({
      passedChecks: checks,
      error: '配对探针失败；响应和会话凭据不写入日志',
    }),
  )
  process.exitCode = 1
})
