import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ProxyAgent, type Dispatcher } from 'undici'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { OAUTH_PROXY_FILENAME } from './ids.js'

const PROXY_ENV_KEYS = [
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'ALL_PROXY',
  'all_proxy',
] as const

export interface LiveProxy {
  readonly httpUrl: string | undefined
  readonly websocketUrl: string | undefined
  dispatcher(): Dispatcher | undefined
  websocketAgent(): HttpsProxyAgent<string> | undefined
}

function envProxy(): string | undefined {
  for (const key of PROXY_ENV_KEYS) {
    const value = process.env[key]
    if (value !== undefined && value.trim().length > 0) return value.trim()
  }
  return undefined
}

function channelUrl(value: unknown, fallback: string | undefined): string | undefined {
  if (typeof value !== 'object' || value === null) return fallback
  const record = value as { enabled?: unknown; url?: unknown }
  if (record.enabled === false) return undefined
  if (typeof record.url === 'string' && record.url.trim().length > 0) return record.url.trim()
  return fallback
}

export async function loadLiveProxy(dshHome = join(homedir(), '.dsh')): Promise<LiveProxy> {
  const fallback = envProxy()
  let httpUrl = fallback
  let websocketUrl = fallback
  try {
    const raw = JSON.parse(await readFile(join(dshHome, OAUTH_PROXY_FILENAME), 'utf8')) as unknown
    const settings = typeof raw === 'object' && raw !== null
      ? (raw as { settings?: unknown }).settings ?? raw
      : undefined
    if (typeof settings === 'object' && settings !== null) {
      const record = settings as { http?: unknown; websocket?: unknown }
      httpUrl = channelUrl(record.http, fallback)
      websocketUrl = channelUrl(record.websocket, fallback)
    }
  } catch {
    // Missing or unreadable plugin proxy file is not fatal.
  }

  let httpDispatcher: Dispatcher | undefined
  let wsAgent: HttpsProxyAgent<string> | undefined
  return {
    httpUrl,
    websocketUrl,
    dispatcher() {
      if (!httpUrl) return undefined
      httpDispatcher ??= new ProxyAgent(httpUrl)
      return httpDispatcher
    },
    websocketAgent() {
      if (!websocketUrl) return undefined
      wsAgent ??= new HttpsProxyAgent(websocketUrl)
      return wsAgent
    },
  }
}
