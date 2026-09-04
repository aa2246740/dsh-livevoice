import { describe, expect, it } from 'vitest'
import { normalizeSdp, prepareRemoteSdp, stripCandidateUfrag } from '../src/sdp.ts'

describe('Codex SDP answer', () => {
  it('strips CR so ice-pwd is a single SDP line', () => {
    const raw = [
      'v=0',
      'a=ice-ufrag:AbCd',
      'a=ice-pwd:Rjpw1xhirGf6Nr90y87qVHlj2VG0eHWv',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111',
      '',
    ].join('\r\n')

    const pwd = raw.split('\n').find(line => line.startsWith('a=ice-pwd:'))
    expect(pwd?.endsWith('\r')).toBe(true)

    const normalized = normalizeSdp(raw)
    const clean = normalized.split('\n').find(line => line.startsWith('a=ice-pwd:'))
    expect(clean).toBe('a=ice-pwd:Rjpw1xhirGf6Nr90y87qVHlj2VG0eHWv')
    expect(normalized.includes('\r')).toBe(false)
  })

  it('strips candidate ufrag values that contain slashes', () => {
    const line = 'a=candidate:1 1 udp 1 20.184.36.134 3478 typ host ufrag ZpYH6R/u23/3oNNwM'
    expect(stripCandidateUfrag(line)).toBe('a=candidate:1 1 udp 1 20.184.36.134 3478 typ host')
    const prepared = prepareRemoteSdp(`${line}\r\na=ice-pwd:UTiIGU4Bn2V6rcJeSrLpzinaEkn5QrFW\r\n`)
    expect(prepared.includes('ufrag')).toBe(false)
    expect(prepared.includes('\r')).toBe(false)
  })

  it('keeps a terminating newline so Chromium GetLine can read the last candidate', () => {
    const last = 'a=candidate:1314481154 1 tcp 1671430143 13.71.25.29 443 typ host tcptype passive'
    const raw = ['v=0', 'a=ice-pwd:UTiIGU4Bn2V6rcJeSrLpzinaEkn5QrFW', last].join('\r\n')
    const prepared = prepareRemoteSdp(raw)
    expect(prepared.endsWith('\n')).toBe(true)
    expect(prepared.endsWith('\n\n')).toBe(false)
    expect(prepared.trimEnd().split('\n').at(-1)).toBe(last)
  })

  it('keeps the oai-events application m-line on a Codex answer', () => {
    const raw = [
      'v=0',
      'a=group:BUNDLE 0 1',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111',
      'a=mid:0',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
      'a=mid:1',
      'a=sctp-port:5000',
      'a=ice-pwd:UTiIGU4Bn2V6rcJeSrLpzinaEkn5QrFW',
    ].join('\r\n')
    const prepared = prepareRemoteSdp(raw)
    expect(prepared.includes('m=application 9 UDP/DTLS/SCTP webrtc-datachannel')).toBe(true)
    expect(prepared.endsWith('\n')).toBe(true)
  })
})
