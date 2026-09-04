export function normalizeSdp(sdp: string): string {
  return sdp.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/** Codex puts `ufrag` on candidate lines. The value contains `/` and some WebRTC stacks reject the line. Session ice-ufrag already carries the credential. */
export function stripCandidateUfrag(sdp: string): string {
  return sdp.replace(/(^a=candidate:.+?) ufrag \S+/gm, '$1')
}

/** Chromium GetLine cannot read the last SDP line unless it ends with LF. */
export function prepareRemoteSdp(sdp: string): string {
  const body = stripCandidateUfrag(normalizeSdp(sdp)).trim()
  return body === '' ? '' : `${body}\n`
}
