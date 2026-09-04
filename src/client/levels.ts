const OUTPUT_ACTIVE_LEVEL = 0.015
const MIN_BARGE_IN_LEVEL = 0.04
const OUTPUT_ECHO_RATIO = 0.65

export function rmsFromAnalyser(analyser: AnalyserNode, buffer: Uint8Array<ArrayBuffer>): number {
  analyser.getByteTimeDomainData(buffer)
  if (buffer.length === 0) return 0
  let sumSquares = 0
  for (let index = 0; index < buffer.length; index += 1) {
    const sample = ((buffer[index] ?? 128) - 128) / 128
    sumSquares += sample * sample
  }
  return Math.min(1, Math.sqrt(sumSquares / buffer.length))
}

/** Kept as a pure threshold helper. The live path no longer chops the mic track with it. */
export function shouldGateEcho(input: number, output: number): boolean {
  const outputActive = output > OUTPUT_ACTIVE_LEVEL
  const echoThreshold = Math.max(MIN_BARGE_IN_LEVEL, output * OUTPUT_ECHO_RATIO)
  return outputActive && input < echoThreshold
}

export function smoothLevel(previous: number, next: number, attack = 0.35, release = 0.12): number {
  const alpha = next > previous ? attack : release
  return previous + (next - previous) * alpha
}

const METER_FLOOR = 0.012

export function meterHeights(input: number): number[] {
  const energy = Math.sqrt(Math.max(0, Math.min(1, input)))
  if (input < METER_FLOOR) return [0, 0, 0, 0, 0, 0, 0]
  return [0.22, 0.4, 0.7, 1, 0.7, 0.4, 0.22].map((weight) => {
    return Math.max(8, Math.round(energy * weight * 100))
  })
}

export function createLevelMonitor(
  stream: MediaStream,
  onLevel: (level: number) => void,
): () => void {
  const context = new AudioContext({ latencyHint: 'interactive' })
  const source = context.createMediaStreamSource(stream)
  const analyser = context.createAnalyser()
  analyser.fftSize = 256
  analyser.smoothingTimeConstant = 0.7
  source.connect(analyser)
  const buffer = new Uint8Array(new ArrayBuffer(analyser.fftSize))
  let frame = 0
  let smoothed = 0
  let lastEmit = 0
  const tick = (now: number): void => {
    smoothed = smoothLevel(smoothed, rmsFromAnalyser(analyser, buffer))
    if (now - lastEmit >= 80) {
      lastEmit = now
      onLevel(smoothed)
    }
    frame = window.requestAnimationFrame(tick)
  }
  frame = window.requestAnimationFrame(tick)
  void context.resume()
  return () => {
    window.cancelAnimationFrame(frame)
    source.disconnect()
    if (context.state !== 'closed') void context.close()
  }
}
