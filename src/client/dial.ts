export function formatConnectingSubtitle(input: {
  readonly stageLabel?: string
  readonly wait: string
  readonly elapsed: string
}): string {
  return input.stageLabel === undefined ? input.wait : `${input.stageLabel} · ${input.elapsed}`
}
