const SILENT_WAV = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'

export interface PreparedPlayback {
  attach(stream: MediaStream): void
  retry(): void
  stop(): void
}

export function applyRemotePlayback(audio: {
  srcObject: MediaProvider | null
  muted: boolean
  volume: number
  autoplay: boolean
}, stream: MediaStream): void {
  audio.srcObject = stream
  audio.muted = false
  audio.volume = 1
  audio.autoplay = true
}

/** Must run inside the user-gesture continuation that started the call. */
export function unlockPlayback(): PreparedPlayback {
  const audio = new Audio()
  audio.autoplay = true
  audio.setAttribute('playsinline', '')
  audio.muted = false
  audio.volume = 1
  audio.src = SILENT_WAV
  document.body.appendChild(audio)
  void audio.play().catch(() => {
    // Silent clip is only to unlock the element; remote play is retried on attach.
  })
  let stopped = false
  let remote: MediaStream | undefined
  let context: AudioContext | undefined
  let graph: MediaStreamAudioSourceNode | undefined
  const fallbackContext = (): AudioContext => {
    context ??= new AudioContext()
    return context
  }
  const playRemote = (stream: MediaStream): void => {
    if (stopped) return
    remote = stream
    applyRemotePlayback(audio, stream)
    void audio.play().catch(async () => {
      if (stopped) return
      const audioContext = fallbackContext()
      if (audioContext.state === 'suspended') await audioContext.resume()
      graph?.disconnect()
      const source = audioContext.createMediaStreamSource(stream)
      source.connect(audioContext.destination)
      graph = source
    })
  }
  return {
    attach: playRemote,
    retry() {
      if (remote) playRemote(remote)
      else void fallbackContext().resume()
    },
    stop() {
      stopped = true
      graph?.disconnect()
      graph = undefined
      remote = undefined
      audio.pause()
      audio.srcObject = null
      audio.removeAttribute('src')
      audio.remove()
      if (context && context.state !== 'closed') void context.close()
    },
  }
}
