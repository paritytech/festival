import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { rmSync } from 'node:fs'
import {
  loadConfig,
  saveConfig,
  domainLabel,
  resolveNetworkConfig,
  readSecrets,
  DEFAULT_CONFIG,
  type DeployConfig,
} from './config'

function tmpPath(): string {
  return resolve(tmpdir(), `deploy.config.${process.pid}.${Math.floor(performance.now())}.json`)
}

test('domainLabel: strips trailing .dot (case-insensitive)', () => {
  assert.equal(domainLabel('myfest.dot'), 'myfest')
  assert.equal(domainLabel('myfest.DOT'), 'myfest')
  assert.equal(domainLabel('  spaced.dot  '), 'spaced')
  assert.equal(domainLabel('nodot'), 'nodot')
})

test('saveConfig/loadConfig: round-trip', () => {
  const p = tmpPath()
  const cfg: DeployConfig = {
    network: 'paseo-next-v2',
    sessionsEnabled: false,
    domains: { admin: 'a.dot', attendee: 'b.dot' },
    custom: null,
  }
  saveConfig(cfg, p)
  const loaded = loadConfig(p)
  assert.deepEqual(loaded, cfg)
  rmSync(p, { force: true })
})

test('loadConfig: returns null when file is absent', () => {
  assert.equal(loadConfig(resolve(tmpdir(), 'does-not-exist-xyz.json')), null)
})

test('loadConfig: fills defaults for missing keys', () => {
  const p = tmpPath()
  saveConfig({ network: 'paseo-next-v2' } as unknown as DeployConfig, p)
  const loaded = loadConfig(p)!
  assert.equal(loaded.network, 'paseo-next-v2')
  assert.equal(loaded.sessionsEnabled, DEFAULT_CONFIG.sessionsEnabled)
  assert.deepEqual(loaded.domains, { admin: '', attendee: '' })
  assert.equal(loaded.custom, null)
  rmSync(p, { force: true })
})

test('resolveNetworkConfig: built-in network resolves from registry', () => {
  const nc = resolveNetworkConfig({ ...DEFAULT_CONFIG, network: 'paseo-next-v2' })
  assert.equal(nc.key, 'paseo-next-v2')
  assert.match(nc.mainChain.wsUrl, /^wss:\/\//)
})

test('resolveNetworkConfig: unknown network throws', () => {
  assert.throws(() => resolveNetworkConfig({ ...DEFAULT_CONFIG, network: 'nope' }))
})

test('resolveNetworkConfig: custom network is built from the custom block', () => {
  const nc = resolveNetworkConfig({
    network: 'custom',
    sessionsEnabled: true,
    domains: { admin: '', attendee: '' },
    custom: { mainWsUrl: 'wss://example/ah', nativeSymbol: 'X', nativeDecimals: 18 },
  })
  assert.equal(nc.key, 'custom')
  assert.equal(nc.mainChain.wsUrl, 'wss://example/ah')
  assert.equal(nc.nativeToken.decimals, 18)
})

test('resolveNetworkConfig: custom without block throws', () => {
  assert.throws(() =>
    resolveNetworkConfig({ network: 'custom', sessionsEnabled: true, domains: { admin: '', attendee: '' }, custom: null }),
  )
})

test('readSecrets: publisher falls back to deployer seed', () => {
  const prev = { d: process.env.DEPLOYER_SEED, m: process.env.DOTNS_MNEMONIC }
  process.env.DEPLOYER_SEED = 'deployer seed'
  delete process.env.DOTNS_MNEMONIC
  const s = readSecrets()
  assert.equal(s.deployerSeed, 'deployer seed')
  assert.equal(s.publisherSeed, 'deployer seed')

  process.env.DOTNS_MNEMONIC = 'publisher seed'
  const s2 = readSecrets()
  assert.equal(s2.publisherSeed, 'publisher seed')

  // restore
  if (prev.d === undefined) delete process.env.DEPLOYER_SEED
  else process.env.DEPLOYER_SEED = prev.d
  if (prev.m === undefined) delete process.env.DOTNS_MNEMONIC
  else process.env.DOTNS_MNEMONIC = prev.m
})
