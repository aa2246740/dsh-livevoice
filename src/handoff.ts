export interface TranscriptLine {
  readonly role: 'user' | 'assistant'
  readonly text: string
}

export interface RealtimeDelegation {
  readonly input: string
  readonly transcriptDelta: readonly TranscriptLine[]
}

const ENVELOPE_RE = /^<realtime_delegation>\s*<input>([\s\S]*?)<\/input>\s*<transcript_delta>([\s\S]*?)<\/transcript_delta>\s*<\/realtime_delegation>$/

const XML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
}

const XML_UNESCAPE: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
}

export const WORKER_HANDOFF_PREFACE =
  'Live voice handoff. Treat <input> as the user\'s current message and use <transcript_delta> only as recent conversational context to resolve references or fragments. Preserve the user\'s wording, intent, and authorization. Context does not expand scope: discussion, hypotheticals, or asking how you would optimize authorize explanation only, while an explicit current request such as "optimize it now" may authorize changes. Read-only status questions are valid requests. Do not claim this handoff or the worker runtime is identical to Codex.'

export function briefLiveDelegation(source: {
  liveText: string
  lastUserSpeech?: string
}): string | undefined {
  const live = source.liveText.trim()
  if (!live) return undefined
  if (isPureGreeting(live)) return undefined
  return live
}

function isPureGreeting(text: string): boolean {
  return /^(?:hi|hey|hello|yo|你好|您好|嗨)[\s,.!?，。！？呀啊]*$/i.test(text)
}

export function renderRealtimeDelegation(delegation: RealtimeDelegation): string | undefined {
  const input = delegation.input.trim()
  if (!input) return undefined
  const delta = delegation.transcriptDelta
    .map(line => `${line.role}: ${escapeXml(flattenLine(line.text))}`)
    .join('\n')
  return `<realtime_delegation>\n  <input>${escapeXml(input)}</input>\n  <transcript_delta>${delta}</transcript_delta>\n</realtime_delegation>`
}

export function renderWorkerHandoff(delegation: RealtimeDelegation): string | undefined {
  const envelope = renderRealtimeDelegation(delegation)
  if (envelope === undefined) return undefined
  return `${WORKER_HANDOFF_PREFACE}\n\n${envelope}`
}

export function parseRealtimeDelegation(text: string): RealtimeDelegation | undefined {
  const match = text.trim().match(ENVELOPE_RE)
  if (!match) return undefined
  const rawInput = match[1]
  const rawDelta = match[2]
  if (rawInput === undefined || rawDelta === undefined) return undefined
  const input = unescapeXml(rawInput).trim()
  if (!input) return undefined
  const transcriptDelta: TranscriptLine[] = []
  for (const line of unescapeXml(rawDelta).split('\n')) {
    const parsed = parseTranscriptLine(line)
    if (parsed !== undefined) transcriptDelta.push(parsed)
  }
  return { input, transcriptDelta }
}

function parseTranscriptLine(line: string): TranscriptLine | undefined {
  if (line.startsWith('user: ')) return { role: 'user', text: line.slice('user: '.length) }
  if (line.startsWith('assistant: ')) return { role: 'assistant', text: line.slice('assistant: '.length) }
  return undefined
}

function flattenLine(text: string): string {
  return text.replaceAll(/\r?\n/g, ' ')
}

function escapeXml(text: string): string {
  return text.replaceAll(/[&<>"']/g, char => XML_ESCAPE[char] ?? char)
}

function unescapeXml(text: string): string {
  return text.replaceAll(/&(?:amp|lt|gt|quot|apos);/g, entity => XML_UNESCAPE[entity] ?? entity)
}
