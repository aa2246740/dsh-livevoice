import { LIVE_EVENTS_CHANNEL } from '../protocol.js'
import { prepareRemoteSdp } from '../sdp.js'

export { prepareRemoteSdp, normalizeSdp } from '../sdp.js'
export { LIVE_EVENTS_CHANNEL } from '../protocol.js'

const ICE_GATHER_MS = 8_000
const ICE_CONNECT_MS = 12_000
const EVENTS_OPEN_MS = 12_000

export interface LivePeer {
  readonly pc: RTCPeerConnection
  readonly localStream: MediaStream
  readonly eventsChannel: RTCDataChannel
  readonly captureLabel: string
  setMuted(muted: boolean): void
  close(): void
}

export async function createLivePeer(options: {
  onRemoteStream(stream: MediaStream): void
  onIceState(state: string): void
  onControlPayload?(payload: string): void
}): Promise<{ peer: LivePeer; offer: string }> {
  const localStream = await captureMicrophone()
  const audioTrack = localStream.getAudioTracks()[0]
  if (audioTrack === undefined) {
    localStream.getTracks().forEach(track => track.stop())
    throw new Error('Microphone track is missing')
  }
  const captureLabel = await waitForMicCapture(audioTrack)

  const pc = new RTCPeerConnection({
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
    iceCandidatePoolSize: 2,
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
    ],
  })
  pc.addEventListener('iceconnectionstatechange', () => {
    options.onIceState(pc.iceConnectionState)
  })
  let delivered = false
  pc.addEventListener('track', (event) => {
    if (event.track.kind !== 'audio' || delivered) return
    delivered = true
    const stream = event.streams[0] ?? new MediaStream([event.track])
    options.onRemoteStream(stream)
  })

  const eventsChannel = pc.createDataChannel(LIVE_EVENTS_CHANNEL, { ordered: true })
  eventsChannel.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') return
    options.onControlPayload?.(event.data)
  })
  const transceiver = pc.addTransceiver(audioTrack, { direction: 'sendrecv', streams: [localStream] })
  preferOpus(transceiver)

  const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false })
  await pc.setLocalDescription(offer)
  await waitForIceGathering(pc)
  const sdp = pc.localDescription?.sdp
  if (!sdp || !sdp.includes('m=audio') || !sdp.includes('m=application')) {
    pc.close()
    localStream.getTracks().forEach(track => track.stop())
    throw new Error('WebRTC produced an offer without audio or the oai-events data channel')
  }
  return {
    offer: sdp,
    peer: {
      pc,
      localStream,
      eventsChannel,
      captureLabel,
      setMuted(value) {
        audioTrack.enabled = !value
      },
      close() {
        eventsChannel.close()
        localStream.getTracks().forEach(track => track.stop())
        pc.close()
      },
    },
  }
}

export async function acceptLiveAnswer(peer: LivePeer, answer: string): Promise<void> {
  const sdp = prepareRemoteSdp(answer)
  if (!sdp.startsWith('v=')) throw new Error('Codex returned a non-SDP answer')
  if (!sdp.includes('m=application')) {
    throw new Error('Codex returned an SDP answer without the oai-events data channel')
  }
  await peer.pc.setRemoteDescription({ type: 'answer', sdp })
  await Promise.all([waitForIceConnected(peer.pc), waitForEventsChannel(peer.eventsChannel)])
}

async function captureMicrophone(): Promise<MediaStream> {
  try {
    return await Promise.race([
      navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
          channelCount: 1,
        },
      }),
      new Promise<MediaStream>((_, reject) => {
        window.setTimeout(() => reject(new Error('Microphone permission timed out')), 15_000)
      }),
    ])
  } catch (error) {
    const name = error instanceof DOMException ? error.name : ''
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      throw new Error('系统或 DSH.app 拒绝了麦克风。状态栏没有橙色录音点时 Codex 听不到。请在系统设置 → 隐私与安全性 → 麦克风里打开 DSH，并重新打开 DSH.app。')
    }
    throw error instanceof Error ? error : new Error(String(error))
  }
}

async function waitForMicCapture(track: MediaStreamTrack): Promise<string> {
  const deadline = Date.now() + 4_000
  while (Date.now() < deadline) {
    if (track.readyState !== 'live') {
      throw new Error('Microphone track ended before capture started')
    }
    if (!track.muted) {
      const settings = track.getSettings()
      return track.label || settings.deviceId || 'microphone'
    }
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, 80)
      track.addEventListener('unmute', () => {
        window.clearTimeout(timer)
        resolve()
      }, { once: true })
    })
  }
  throw new Error(
    `麦克风一直处于 muted（${track.readyState}）。系统状态栏没有橙色录音点，Codex 只能收到静音。`,
  )
}

function preferOpus(transceiver: RTCRtpTransceiver): void {
  const capabilities = RTCRtpSender.getCapabilities?.('audio')
  if (capabilities == null || typeof transceiver.setCodecPreferences !== 'function') return
  const opus = capabilities.codecs.filter(codec => codec.mimeType.toLowerCase() === 'audio/opus')
  if (opus.length > 0) transceiver.setCodecPreferences(opus)
}

function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const finish = (): void => {
      window.clearTimeout(timer)
      pc.removeEventListener('icegatheringstatechange', onGathering)
      pc.removeEventListener('icecandidate', onCandidate)
      resolve()
    }
    const timer = window.setTimeout(finish, ICE_GATHER_MS)
    const onGathering = (): void => {
      if (pc.iceGatheringState === 'complete') finish()
    }
    const onCandidate = (event: RTCPeerConnectionIceEvent): void => {
      if (event.candidate === null) finish()
    }
    pc.addEventListener('icegatheringstatechange', onGathering)
    pc.addEventListener('icecandidate', onCandidate)
    if (pc.iceGatheringState === 'complete') finish()
  })
}

function waitForIceConnected(pc: RTCPeerConnection): Promise<void> {
  const connected = pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed'
    || pc.connectionState === 'connected'
  if (connected) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const finish = (error?: Error): void => {
      window.clearTimeout(timer)
      pc.removeEventListener('iceconnectionstatechange', onState)
      pc.removeEventListener('connectionstatechange', onState)
      if (error) reject(error)
      else resolve()
    }
    const timer = window.setTimeout(() => {
      finish(new Error(
        `WebRTC ICE 未连通（${pc.iceConnectionState}）。控制通道能连上，但语音媒体穿不过当前网络/代理。`,
      ))
    }, ICE_CONNECT_MS)
    const onState = (): void => {
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed'
        || pc.connectionState === 'connected') {
        finish()
        return
      }
      if (pc.iceConnectionState === 'failed' || pc.connectionState === 'failed') {
        finish(new Error('WebRTC ICE failed. Live voice media did not reach Codex.'))
      }
    }
    pc.addEventListener('iceconnectionstatechange', onState)
    pc.addEventListener('connectionstatechange', onState)
    onState()
  })
}

function waitForEventsChannel(channel: RTCDataChannel): Promise<void> {
  if (channel.readyState === 'open') return Promise.resolve()
  return new Promise((resolve, reject) => {
    const finish = (error?: Error): void => {
      window.clearTimeout(timer)
      channel.removeEventListener('open', onOpen)
      channel.removeEventListener('error', onError)
      if (error) reject(error)
      else resolve()
    }
    const timer = window.setTimeout(() => {
      finish(new Error('Codex oai-events 数据通道未打开。ICE 通了也不算通话真正开始。'))
    }, EVENTS_OPEN_MS)
    const onOpen = (): void => { finish() }
    const onError = (): void => {
      finish(new Error('Codex oai-events 数据通道失败'))
    }
    channel.addEventListener('open', onOpen)
    channel.addEventListener('error', onError)
    if (channel.readyState === 'open') finish()
  })
}
