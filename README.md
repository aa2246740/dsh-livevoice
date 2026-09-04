# dsh-livevoice

Codex realtime voice (`Ctrl+L` / `/live`) for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

This is a protocol-complete port of omp’s GPT-Live path: ChatGPT OAuth, WebRTC media, Frameless Bidi sideband, client-side delegation into the current DSH session. It is not a local STT/TTS plugin.

## Compatibility and build

The current source targets DeepSeek Harness `dsh-v0.1.2-rc.1`. Build the browser half against the intended Harness checkout so dshx uses that target's public client platform table:

```sh
pnpm install --frozen-lockfile
DSHX_HARNESS=/absolute/path/to/deepseek-harness pnpm build
```

## Auth: OAuth is required

Live voice **cannot** use a normal OpenAI platform API key or the default DeepSeek LLM login. Signaling posts to `https://chatgpt.com/backend-api/codex/realtime/calls` with a ChatGPT / Codex OAuth access token and a `Codex Desktop` originator.

The plugin does **not** depend on `dsh-oauth-login` being loaded. It reads credentials in this order:

1. `$DSH_HOME/.dsh-oauth-auth.json` (`openai-codex`) — written by **dsh-oauth-login** / 订阅登录
2. DSH credential store `llm-pi-ai/openai-codex` — official **Settings → models → ChatGPT Codex OAuth**
3. `~/.codex/auth.json` — official `codex login` (read-only fallback)

If none of those hold an OAuth grant, the Live button fails with `No Codex OAuth credential is available for a live call.`

`dsh-oauth-login` is the usual way to get that grant inside DSH, but a user who already signed in through DSH’s built-in `openai-codex` OAuth flow is enough. A DeepSeek API key is not.

## What is ported

| omp | DSH |
|---|---|
| `protocol.ts` Frameless Bidi | same types and codecs |
| Codex signaling + sideband | Host proxy (avoids browser CORS / WS headers) |
| Native WebRTC / Opus | Browser `RTCPeerConnection` + `getUserMedia` |
| `AgentSession.sendCustomMessage` | `agent.steer` while a turn is open; `agent.followup` when idle or running with no open turn |
| TUI visualizer | composer Live chip + live bar |
| `Ctrl+L` / `/live` | same |
| DeviceCheck attestation | not ported (omp also skips this off Apple silicon) |

The voice model is `gpt-live-1-codex`. It only talks. Repository work is delegated into this DSH session.

## Use

Composer **Live** button, or `Ctrl+L`, or `/live`. Esc ends the call. Space mutes while the live bar is focused.

Voice names match Codex: arbor, breeze, cove, ember, juniper, maple, sol, spruce, vale.

HTTP/WS outbound honors `$DSH_HOME/.dsh-oauth-proxy.json` (same file as dsh-oauth-login) and `HTTPS_PROXY`.
