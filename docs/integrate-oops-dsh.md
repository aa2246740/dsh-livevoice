# Integrate dsh-livevoice into oops-dsh

Audience: the oops-dsh agent. Canonical plugin (read-only): `/Users/wu/orca/projects/DSH-livevoice`.

This is not a UI-only job. Host signaling, Codex OAuth, WebRTC, and session `steer`/`followup` already live in that repo. OOPS work is: mount a **copy** of the Host plugin onto the OOPS Host, then put the existing Live chip onto the island because the island does not render official DSH composer slots.

## Hard rules

These are stop conditions. Violating any of them is a failed run.

**Do not edit the canonical plugin.** Never write, format, move, `git` mutate, or `search_replace` under `/Users/wu/orca/projects/DSH-livevoice`. Read it. Import the built `lib/` from a clone if you must change behavior.

**If you need a code change, clone first.** Separate directory, separate project, for example `/Users/wu/orca/projects/DSH-livevoice-oops`. `dshx plugin add` that clone into **oops-dsh only**. Do not add the canonical path as a writable workshop. A symlink from oops `my-plugins` onto the canonical tree is the same as editing the original: forbidden.

**Do not touch the user’s daily DSH.** Leave these alone:

| Keep out | Why |
|---|---|
| `/Users/wu/Documents/Codex/2026-08-15/bang/deepseek-harness-rc8` | Daily DeepSeek Harness checkout |
| That checkout’s `my-plugins/`, `cordis.patch.yml`, web profile | Livevoice is already mounted there |
| `127.0.0.1:43127` and its node PID | Daily Host. Do not kill, restart, or rebind |
| `/Users/wu/Applications/DSH.app` | Daily app |
| `~/.dsh` | Daily `DSH_HOME` |
| Tailscale Serve / `--trusted-host` on that Host | Phone path for the original DSH |

OOPS uses its own checkout, its own port, its own home `~/.oops-dsh`. Never `~/.dsh`. Never port `43127`.

Also:

- Do not copy plugin sources into `oops-dsh/packages/`.
- Do not edit `openBrain`.
- Do not kill an OOPS Host to retry. Attach to the existing oops process.
- Live voice needs ChatGPT / Codex OAuth. A DeepSeek API key cannot signal Codex realtime.

## What already exists

| Layer | Owner | What it does |
|---|---|---|
| Host `src/dsh-livevoice.ts` | this repo | `LiveCallRegistry`, HTTP `/plugins/dsh-livevoice/*`, `/live`, Codex signaling + sideband |
| Client `src/client/` | this repo | WebRTC, chip, dock, hear/say cards, settings row |
| Composer slots | official DSH `ui-conversation` | `conversation.input.left` / `.dock` / `conversation.chat.commandview` |
| OOPS island | `oops-dsh/packages/oops/app/src/client/openbrain-port/agent/floating-island.tsx` | bottom capsule; does **not** call `renderSlot('conversation.input.left')` |

If you only restyle the island and skip Host install, the chip has nothing to call. If you only dshx-install and skip the island, Host works but the user never sees Live.

## Step 1 — Host plugin (done when the **OOPS** boot log prints the marker)

Work only against the oops-dsh checkout and `~/.oops-dsh`. Clone the plugin if you will patch it:

```
dshx which
# read-only consume of the canonical tree is allowed only if you never write it.
# any edit: clone first, then add the clone.
cp -R /Users/wu/orca/projects/DSH-livevoice /Users/wu/orca/projects/DSH-livevoice-oops
dshx plugin add /Users/wu/orca/projects/DSH-livevoice-oops --profile web --harness <oops-dsh-or-oops-harness>
```

Do not run `dshx plugin add` against harness-rc8. Do not pass `--port 43127`.

Proof, all required:

- Boot log contains `[my-plugins/dsh-livevoice] loaded`
- `GET /plugins/dsh-livevoice/status` returns JSON with `ready` and `voices`
- `trustedRequest` is loopback-only. Remote/Tailscale needs the same `--trusted-host <MagicDNS>` the Host already uses. Do not bind `0.0.0.0` to dodge the fence.

Auth order inside the plugin (do not invent a fourth store):

1. `$DSH_HOME/.dsh-oauth-auth.json` (`openai-codex`)
2. DSH credential `llm-pi-ai/openai-codex` (Settings Codex OAuth)
3. `~/.codex/auth.json`

`ready: false` / `source: none` means OAuth is missing. Sign in. Do not wire a platform API key.

Outbound ChatGPT/Codex HTTP uses `$DSH_HOME/.dsh-oauth-proxy.json` or `HTTPS_PROXY`.

## Step 2 — Island UI (done when the island can start and end a call)

Official slots stay registered. The OOPS island still will not show them. Mount the **existing** client components; do not rebuild WebRTC.

Import from the plugin client entry (`dsh-livevoice/client`): `LiveChip`, `LiveDock`. Need a `LiveClientSession` per DSH `sessionId` (the plugin already keys this in `src/client/index.tsx` via `sessionOf`).

Place:

- **Chip** on the island tool row next to `@board` / send, not a second composer.
- **Dock** above the island (full-width live bar: phase, transcript, mute, end). Matches `conversation.input.dock`.
- **Voice** stays in Settings, not on the island. Official seat is `settings.general.item` id `dsh-livevoice`. If OOPS settings is the island popover instead of the DSH settings modal, add one “Live 声线” select there that calls `chooseStoredVoice` from `src/client/session.ts`. Do not put the select back on the capsule.

Hear/say bubbles (`livevoice-hear` / `livevoice` command cards) need `conversation.chat.commandview`. If the island chat path is not that slot, map those two command names to `LiveHear` / `LiveSay` in whatever chat surface OOPS uses.

Keyboard (already in the plugin client): `Ctrl+L` toggle, `Esc` end, `Space` mute when the live bar is focused. Keep them. Do not steal `Ctrl+L` for something else on the island.

## Step 3 — Session wiring (done when speech becomes a worker turn)

Do not reimplement signaling. The Host already:

- talks to Live (`gpt-live-1-codex`)
- injects a **brief** via `createUserMessage` + `agent.steer` (open turn) or `agent.followup` (idle)
- source `{ kind: 'plugin', plugin: 'dsh-livevoice' }`

Worker text is `briefLiveDelegation` then the Codex envelope. Casual hear stays a `livevoice-hear` command, not `user/message`.

OOPS must keep using the same DSH `Agent` / `Session` the Host `LiveCallRegistry` resolves through `ctx.agents.get(SessionId)`. If the island’s “work” session is a different id than the chip’s `sessionId`, Live will throw `Session … is not active`.

## Verify

1. Hard-refresh the OOPS app after client build.
2. Status `ready: true` with a Codex OAuth source.
3. Island Live starts: mic permission, then connecting copy, then listening. Host log: `call start` then `call ready rtc_…`.
4. Speak. Dock shows hear text. Worker inbox is a short imperative in `<input>`, not oral fillers (`东西啊`, `那个-`).
5. Mute / end work. `Ctrl+L` matches the chip.
6. Voice change in settings applies on the **next** call.

Fail-closed: chip with no Host plugin, Host plugin with no island mount, or Live pointed at the wrong session id.

## Out of scope

- Any write under `/Users/wu/orca/projects/DSH-livevoice`.
- Any write under harness-rc8, DSH.app, or `~/.dsh`.
- Forking controller/signaling into `oops-dsh/packages/` instead of a cloned plugin project.
- Local STT/TTS.
- TURN. Current client is STUN-only.
- Changing `trustedRequest` to allow the public internet.
