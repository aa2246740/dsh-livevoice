import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execute = promisify(execFile)
export const MICROPHONE_SETTINGS = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
export type HostMicrophone = 'missing-audio-entitlement' | 'unknown'

// Inspect only the App containing this Host; no arbitrary paths supplied by a client.
export function enclosingMacApp(executable: string): string | undefined {
  const index = executable.indexOf('.app/Contents/')
  return index < 0 ? undefined : executable.slice(0, index + 4)
}
export function missingAudioEntitlement(signature: string, entitlements: string): boolean {
  return /flags=[^\n]*\(runtime\)/u.test(signature)
    && !/com\.apple\.security\.device\.audio-input(?:<\/key>\s*<true\s*\/>|\s*\[Value\]\s*\[Bool\] true)/u.test(entitlements)
}
let inspected: Promise<HostMicrophone> | undefined
export function describeHostMicrophone(): Promise<HostMicrophone> {
  return inspected ??= inspect()
}
async function inspect(): Promise<HostMicrophone> {
  const app = enclosingMacApp(process.execPath)
  if (process.platform !== 'darwin' || !app) return 'unknown'
  try {
    const [signature, entitlements] = await Promise.all([
      execute('/usr/bin/codesign', ['-dv', app], { timeout: 3000, maxBuffer: 65536 }),
      execute('/usr/bin/codesign', ['-d', '--entitlements', '-', app], { timeout: 3000, maxBuffer: 65536 }),
    ])
    return missingAudioEntitlement(signature.stderr, entitlements.stdout + entitlements.stderr)
      ? 'missing-audio-entitlement' : 'unknown'
  } catch { return 'unknown' }
}
export async function openMicrophoneSettings(): Promise<void> {
  if (process.platform !== 'darwin' || !enclosingMacApp(process.execPath)) {
    throw new Error('Microphone settings require the macOS desktop Host')
  }
  await execute('/usr/bin/open', [MICROPHONE_SETTINGS], { timeout: 5000 })
}
