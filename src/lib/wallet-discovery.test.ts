import assert from 'node:assert/strict'
import test from 'node:test'
import type { EIP1193Provider } from 'viem'
import {
  discoverWallets,
  isWalletInjectionConflict,
  type WalletProvider,
} from './wallet-discovery.ts'

test('EIP-6963 discovery survives a conflicting global getter and keeps the chosen provider', () => {
  const target = new EventTarget()
  Object.defineProperty(target, 'ethereum', {
    get() {
      throw new TypeError('Cannot redefine property: ethereum')
    },
  })
  const provider = {
    request: async () => [],
    on() {},
    removeListener() {},
  } as EIP1193Provider
  const icon =
    'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E'
  const announce = () =>
    target.dispatchEvent(
      new CustomEvent('eip6963:announceProvider', {
        detail: {
          info: { uuid: 'one', name: 'MetaMask', rdns: 'io.metamask', icon },
          provider,
        },
      }),
    )
  target.addEventListener('eip6963:requestProvider', announce)
  let wallets: WalletProvider[] = []
  const stop = discoverWallets(target, (value) => {
    wallets = value
  })
  announce()
  assert.equal(wallets.length, 1)
  assert.equal(wallets[0].icon, icon)
  assert.equal(wallets[0].provider, provider)
  const second = { ...provider }
  target.dispatchEvent(
    new CustomEvent('eip6963:announceProvider', {
      detail: {
        info: {
          uuid: 'two',
          name: 'Rabby',
          rdns: 'io.rabby',
          icon: 'https://tracking.invalid/icon.png',
        },
        provider: second,
      },
    }),
  )
  assert.equal(wallets.length, 2)
  assert.equal(wallets[0].provider, provider)
  assert.equal(wallets[1].provider, second)
  assert.equal(wallets[1].icon, undefined)
  stop()
  target.dispatchEvent(
    new CustomEvent('eip6963:announceProvider', {
      detail: {
        info: { uuid: 'three', name: 'Other' },
        provider: { ...provider },
      },
    }),
  )
  assert.equal(wallets.length, 2)
})

test('only a known collision from an extension is excluded from app error notifications', () => {
  assert.equal(
    isWalletInjectionConflict({
      message: 'Cannot redefine property: ethereum',
      filename: 'chrome-extension://abc/evmAsk.js',
    }),
    true,
  )
  assert.equal(
    isWalletInjectionConflict({
      message: 'Cannot redefine property: ethereum',
      filename: 'https://hyperliquid.sunshinedairy.net/app.js',
    }),
    false,
  )
  assert.equal(
    isWalletInjectionConflict({
      message: 'signature failed',
      filename: 'chrome-extension://abc/wallet.js',
    }),
    false,
  )
  assert.equal(
    isWalletInjectionConflict({
      message: 'Cannot redefine property: ethereum',
    }),
    false,
  )
})

test('legacy discovery tolerates a throwing global getter without losing later EIP-6963 announcements', async () => {
  const target = new EventTarget()
  Object.defineProperty(target, 'ethereum', {
    get() {
      throw new TypeError('extension collision')
    },
  })
  let wallets: WalletProvider[] = []
  const stop = discoverWallets(target, (value) => {
    wallets = value
  })
  await new Promise((resolve) => setTimeout(resolve, 220))
  assert.equal(wallets.length, 0)
  const provider = {
    request: async () => [],
    on() {},
    removeListener() {},
  } as EIP1193Provider
  target.dispatchEvent(
    new CustomEvent('eip6963:announceProvider', {
      detail: { info: { uuid: 'late', name: 'MetaMask' }, provider },
    }),
  )
  assert.equal(wallets[0].provider, provider)
  stop()
})
