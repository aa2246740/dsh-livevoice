export const LIVE_FAILURE_KINDS = [
  'auth',
  'quota',
  'forbidden',
  'signaling',
  'network',
  'session',
  'media',
  'unknown',
] as const

export type LiveFailureKind = (typeof LIVE_FAILURE_KINDS)[number]

export function isLiveFailureKind(value: string): value is LiveFailureKind {
  return (LIVE_FAILURE_KINDS as readonly string[]).includes(value)
}
