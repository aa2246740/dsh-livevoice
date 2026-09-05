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

Delegation preserves the user's current wording. A bounded recent transcript is attached separately so the worker can resolve references and sentence fragments without inheriting broader authorization: asking how a change could be done remains analysis, while an explicit request to do it authorizes execution. Read-only repository and session-status questions may be delegated.

## Use

Composer **Live** button, or `Ctrl+L`, or `/live`. Esc ends the call. Space mutes while the live bar is focused.

“Ready — speak now” is shown only after WebRTC media/data-channel connection, an explicit Codex session-ready event, and a live microphone track. Until then the UI remains connecting and microphone transmission stays gated. A readiness timeout fails with a retry action; it never silently counts as connected. You can cancel while dialing.

The Host maintains one live call across browser pages. Concurrent dials are serialized; a later dial replaces the earlier call. Failed dials do not block the queue, and shutdown waits for earlier dial attempts before clearing their calls.

The live dock shows task receipts for the actual input and handoff sent to DSH. States come from dispatch, matching `agent/inbox/claimed`, `agent/inbox/discarded`, and the claimed turn's `turn/end` reason. “Worker replied” means only that a completed turn produced a response associated with the request; it is not verification of the work.

Changing topics does not erase earlier answers. The bridge retains every non-tool response and associates it with requests consumed by the worker before that response. A later unclaimed request cannot receive an earlier answer; if several requests were consumed together, their answer is explicitly labeled shared, not independently fulfilled. Replies are returned at the end of their claimed turn even when another request is still queued for the next turn. Actual terminal states also go to the voice context, so it can report no reply, cancellation, failure, or stopped tracking instead of promising a nonexistent future result. There is no semantic topic classifier or extra worker process. This is an event-based approximation of answer ownership, not a guarantee of semantic correctness or 100% Codex behavior parity.

Results and unsuccessful terminal outcomes use the explicit `speakable` context channel; routine progress and successful receipt metadata use `commentary`. These are the existing [Frameless Bidi channels](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/endpoint/realtime_websocket/protocol.rs), not a new transport or a promise that speech generation is infallible.

The server replays current-call receipts when the SSE connection reconnects and keeps all active receipts plus the 24 most recent settled receipts. The current page keeps its existing cards after hangup, when another call replaces the current call, and across a redial; replacement stops live tracking for the old call. Refreshing the page loses page-local history, and a newly opened page cannot retrieve receipts from an old replaced call because there is deliberately no new database. When a call ends while DSH work continues, its card freezes at “Call ended · follow in session” instead of pretending the work failed or completed.

Voice names match Codex: arbor, breeze, cove, ember, juniper, maple, sol, spruce, vale.

HTTP/WS outbound honors `$DSH_HOME/.dsh-oauth-proxy.json` (same file as dsh-oauth-login) and `HTTPS_PROXY`.
