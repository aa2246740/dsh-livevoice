import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Agent } from "@deepseek-ai/dsh-agent"
import { createAssistantMessage, createUserMessage, ToolCallId } from "@deepseek-ai/dsh-llm"
import type { SessionEvent } from "@deepseek-ai/dsh-session"
import type { CodexAccess } from "../src/auth.ts"
import type { LiveProxy } from "../src/proxy.ts"
import type { LiveClientMessage, LiveServerEvent } from "../src/protocol.ts"
import { LiveCallRegistry, type LiveUiEvent } from "../src/controller.ts"

const wire = vi.hoisted(() => ({
  liveEvent: undefined as undefined | ((event: LiveServerEvent) => void),
  sentMessages: [] as LiveClientMessage[],
}))

vi.mock("../src/signaling.js", () => ({
  signalLiveCall: async () => ({ callId: "fixture-call", answer: "fixture-answer" }),
}))
vi.mock("../src/sideband.js", () => ({
  LiveSideband: class {
    constructor(_access: unknown, _session: unknown, _realtime: unknown, _proxy: unknown,
      handlers: { onEvent(event: LiveServerEvent): void }) { wire.liveEvent = handlers.onEvent }
    async connect() {}
    async close() {}
    async send(message: LiveClientMessage) {
      wire.sentMessages.push(message)
    }
  },
}))

type Handler = (...args: any[]) => void

function fixtureAgent() {
  const handlers = new Map<string, Handler[]>()
  const events: SessionEvent[] = []
  const followup = vi.fn()
  const steer = vi.fn()
  const session = {
    id: "fixture-session",
    snapshotEvents: () => events,
  }
  const agent = {
    status: "idle",
    followup,
    steer,
    session,
    ctx: {
      on: (name: string, handler: Handler) => {
        const list = handlers.get(name) ?? []
        list.push(handler)
        handlers.set(name, list)
        return () => {}
      },
    },
  } as unknown as Agent
  return {
    agent,
    session,
    events,
    followup,
    steer,
    emit(name: string, ...args: unknown[]) {
      for (const handler of handlers.get(name) ?? []) handler(...args)
    },
    pushAndEmit(event: SessionEvent) {
      events.push(event)
      for (const handler of handlers.get("session/event") ?? []) handler(session, event)
    },
  }
}

function delegation(id: string, text: string): LiveServerEvent {
  return {
    type: "delegation.created",
    item: {
      type: "delegation",
      target: "client",
      id,
      content: [{ type: "input_text", text }],
    },
  }
}

function assistantEvent(turn: number, step: number, text: string): SessionEvent {
  return {
    type: "assistant/message",
    seq: turn * 100 + step,
    time: turn * 100 + step,
    data: {
      turn,
      step,
      message: createAssistantMessage({
        content: [{ type: "text", text }],
        source: { provider: "mock", model: "mock" },
      }),
    },
  }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 10))

type EndReason = Extract<SessionEvent, { type: 'turn/end' }>['data']['reason']

async function scenario(run: (fixture: ReturnType<typeof fixtureAgent>, events: LiveUiEvent[], close: () => Promise<void>) => Promise<void>) {
  const fixture = fixtureAgent()
  const registry = new LiveCallRegistry(() => fixture.agent, async () => ({} as CodexAccess), {} as LiveProxy)
  const call = await registry.start({ sessionId: 'fixture-session', offer: 'fixture-offer' })
  const events: LiveUiEvent[] = []
  call.subscribe(event => events.push(event))
  try { await run(fixture, events, () => call.close()) } finally { await call.close() }
}

function end(fixture: ReturnType<typeof fixtureAgent>, turn: number, reason: EndReason = { kind: 'completed' }) {
  fixture.pushAndEmit({ type: 'turn/end', seq: turn * 100 + 99, time: 1, data: { turn, reason } })
}

function payload(id: string, commentary = false) {
  return wire.sentMessages.filter(message => message.type === 'delegation.context.append'
    && message.delegation_item_id === id && (commentary || message.channel === 'speakable'))
    .flatMap(message => 'content' in message ? message.content.map(block => block.text) : []).join('')
}

function latest(events: LiveUiEvent[], id: string) {
  return events.filter(event => event.type === 'task-receipt' && event.receipt.id === id).at(-1)
}

beforeEach(() => {
  wire.liveEvent = undefined
  wire.sentMessages = []
})

describe("LiveVoice topic-switch and multi-turn delegation scenarios", () => {
  it.each(['finish', 'discard-before', 'discard-after'] as const)('settles A independently of queued B: %s', async action => {
    await scenario(async (fixture, events) => {
      wire.liveEvent?.(delegation('A', 'first question'))
      const a = fixture.followup.mock.calls[0][0]
      fixture.emit('agent/inbox/claimed', { message: a, turn: 1 })
      wire.liveEvent?.(delegation('B', 'second question'))
      const b = fixture.followup.mock.calls[1][0]
      if (action === 'discard-before') fixture.emit('agent/inbox/discarded', { message: b })
      fixture.pushAndEmit(assistantEvent(1, 1, 'original answer'))
      end(fixture, 1)
      await flush()
      expect(payload('A')).toContain('original answer')
      expect(payload('B')).not.toContain('original answer')
      expect(latest(events, 'A')).toMatchObject({ receipt: { status: 'replied' } })
      if (action === 'finish') {
        expect(latest(events, 'B')).toMatchObject({ receipt: { status: 'queued' } })
        expect(events.filter(event => event.type === 'phase').at(-1)).toMatchObject({ phase: 'working' })
        fixture.emit('agent/inbox/claimed', { message: b, turn: 2 })
        fixture.pushAndEmit(assistantEvent(2, 1, 'second answer'))
        end(fixture, 2)
        await flush()
        expect(payload('B')).toContain('second answer')
        expect(payload('A')).not.toContain('second answer')
      } else {
        if (action === 'discard-after') fixture.emit('agent/inbox/discarded', { message: b })
        await flush()
        expect(payload('B')).toContain('"status":"discarded"')
        expect(latest(events, 'B')).toMatchObject({ receipt: { status: 'discarded' } })
      }
      expect(events.filter(event => event.type === 'phase').at(-1)).toMatchObject({ phase: 'listening' })
    })
  })

  it('returns a labeled shared answer and truthful settled state to both requests', async () => {
    await scenario(async (fixture, events) => {
      for (const [index, id] of ['A', 'B'].entries()) {
        wire.liveEvent?.(delegation(id, `question ${id}`))
        fixture.emit('agent/inbox/claimed', { message: fixture.followup.mock.calls[index][0], turn: 1 })
      }
      fixture.pushAndEmit(assistantEvent(1, 1, 'combined answer'))
      end(fixture, 1)
      await flush()
      for (const id of ['A', 'B']) {
        expect(payload(id)).toContain('Shared worker response')
        expect(payload(id)).toContain('combined answer')
        expect(payload(id, true)).toContain('"active":[]')
        expect(latest(events, id)).toMatchObject({ receipt: { status: 'replied' } })
      }
    })
  })

  it.each([
    [{ kind: 'aborted' }, 'cancelled'],
    [{ kind: 'blocked' }, 'blocked'],
    [{ kind: 'interrupted' }, 'interrupted'],
    [{ kind: 'max-tokens' }, 'max-tokens'],
    [{ kind: 'error', error: { message: 'fixture failed', code: 'FIXTURE' } }, 'failed'],
  ] as [EndReason, string][])('reports %s despite earlier ordinary text', async (reason, status) => {
    await scenario(async (fixture, events) => {
      wire.liveEvent?.(delegation('A', 'question'))
      fixture.emit('agent/inbox/claimed', { message: fixture.followup.mock.calls[0][0], turn: 1 })
      fixture.pushAndEmit(assistantEvent(1, 1, 'partial result'))
      end(fixture, 1, reason)
      await flush()
      expect(payload('A')).toContain('Partial worker response')
      expect(payload('A')).toContain('partial result')
      expect(payload('A')).not.toContain('"Agent Final Message"')
      expect(payload('A')).toContain(`"status":"${status}"`)
      expect(payload('A')).toContain('No tracked worker requests remain active')
      expect(latest(events, 'A')).toMatchObject({ receipt: { status } })
    })
  })

  it('does not treat tool commentary as an answer and reports no-reply to Live', async () => {
    await scenario(async (fixture, events) => {
      wire.liveEvent?.(delegation('A', 'question'))
      fixture.emit('agent/inbox/claimed', { message: fixture.followup.mock.calls[0][0], turn: 1 })
      const event = assistantEvent(1, 1, 'searching')
      if (event.type !== 'assistant/message') throw new Error('fixture')
      fixture.pushAndEmit({ ...event, data: { ...event.data, message: createAssistantMessage({
        content: [
          { type: 'text', text: 'searching' },
          { type: 'tool-call', id: ToolCallId('tool'), name: 'search', arguments: {} },
        ],
        source: { provider: 'mock', model: 'mock' },
      }) } })
      end(fixture, 1)
      await flush()
      expect(payload('A')).not.toContain('searching')
      expect(payload('A')).toContain('"status":"no-reply"')
      expect(latest(events, 'A')).toMatchObject({ receipt: { status: 'no-reply' } })
    })
  })

  it('ignores unrelated events and replay without losing multiple answers', async () => {
    await scenario(async (fixture) => {
      const request = delegation('A', 'question')
      wire.liveEvent?.(request)
      wire.liveEvent?.(request)
      expect(fixture.followup).toHaveBeenCalledOnce()
      fixture.emit('agent/inbox/claimed', { message: createUserMessage({ content: [] }), turn: 7 })
      fixture.pushAndEmit(assistantEvent(7, 1, 'unrelated'))
      end(fixture, 7)
      fixture.emit('agent/inbox/claimed', { message: fixture.followup.mock.calls[0][0], turn: 1 })
      const first = assistantEvent(1, 1, 'first answer')
      fixture.pushAndEmit(first)
      fixture.pushAndEmit(first)
      fixture.pushAndEmit(assistantEvent(1, 2, 'second answer'))
      end(fixture, 1)
      await flush()
      const before = payload('A')
      end(fixture, 1)
      await flush()
      expect(payload('A')).toBe(before)
      expect(before).not.toContain('unrelated')
      expect(before.match(/first answer/g)).toHaveLength(1)
      expect(before).toContain('first answer\n\nsecond answer')
    })
  })

  it('sends tracking-stopped before closing, without claiming worker cancellation', async () => {
    await scenario(async (fixture, events, close) => {
      wire.liveEvent?.(delegation('A', 'question'))
      fixture.emit('agent/inbox/claimed', { message: fixture.followup.mock.calls[0][0], turn: 1 })
      await close()
      expect(payload('A')).toContain('"status":"tracking-stopped"')
      expect(payload('A')).toContain('DSH work may continue')
      expect(latest(events, 'A')).toMatchObject({ receipt: { status: 'tracking-stopped' } })
    })
  })

  it("A-only scenario passes", async () => {
    const fixture = fixtureAgent()
    const registry = new LiveCallRegistry(
      () => fixture.agent,
      async () => ({} as CodexAccess),
      {} as LiveProxy,
    )
    const call = await registry.start({ sessionId: "fixture-session", offer: "fixture-offer" })
    const events: LiveUiEvent[] = []
    call.subscribe(event => events.push(event))

    try {
      wire.liveEvent?.(delegation("del-A", "Request A"))
      const msgA = fixture.followup.mock.calls[0]?.[0]
      expect(msgA).toBeDefined()

      fixture.emit("agent/inbox/claimed", { message: msgA, turn: 1 })
      fixture.pushAndEmit(assistantEvent(1, 1, "Answer A"))
      fixture.pushAndEmit({
        type: "turn/end",
        seq: 102,
        time: 102,
        data: { turn: 1, reason: { kind: "completed" } },
      } satisfies SessionEvent)
      await flush()

      const finalMessages = wire.sentMessages.filter(
        (m): m is Extract<LiveClientMessage, { type: "delegation.context.append" }> =>
          m.type === "delegation.context.append" && m.channel === 'speakable' && m.content.some(c => c.text.includes("Answer A"))
      )
      expect(finalMessages.length).toBeGreaterThan(0)
      expect(finalMessages.every(m => m.delegation_item_id === "del-A")).toBe(true)

      const receipts = events.filter(e => e.type === "task-receipt" && e.receipt.id === "del-A")
      expect(receipts.at(-1)?.receipt.status).toBe("replied")
    } finally {
      await call.close()
    }
  })

  it("A reply followed by B reply in same turn preserves both answers and routes them to correct IDs", async () => {
    const fixture = fixtureAgent()
    const registry = new LiveCallRegistry(
      () => fixture.agent,
      async () => ({} as CodexAccess),
      {} as LiveProxy,
    )
    const call = await registry.start({ sessionId: "fixture-session", offer: "fixture-offer" })
    const events: LiveUiEvent[] = []
    call.subscribe(event => events.push(event))

    try {
      // 1. delegate A
      wire.liveEvent?.(delegation("del-A", "Request A"))
      const msgA = fixture.followup.mock.calls[0]?.[0]

      // 2. claim A in turn 1
      fixture.emit("agent/inbox/claimed", { message: msgA, turn: 1 })

      // 3. delegate B while A is running
      wire.liveEvent?.(delegation("del-B", "Request B"))
      const msgB = fixture.followup.mock.calls[1]?.[0]

      // 4. step 1 answers A
      fixture.pushAndEmit(assistantEvent(1, 1, "Answer A"))

      // 5. claim B in turn 1 (before step 2)
      fixture.emit("agent/inbox/claimed", { message: msgB, turn: 1 })

      // 6. step 2 answers B
      fixture.pushAndEmit(assistantEvent(1, 2, "Answer B"))

      // 7. turn/end completed
      fixture.pushAndEmit({
        type: "turn/end",
        seq: 103,
        time: 103,
        data: { turn: 1, reason: { kind: "completed" } },
      } satisfies SessionEvent)
      await flush()

      // Answer A must be delivered to del-A and NOT del-B
      const answerAMessages = wire.sentMessages.filter(
        (m): m is Extract<LiveClientMessage, { type: "delegation.context.append" }> =>
          m.type === "delegation.context.append" && m.channel === 'speakable' && m.content.some(c => c.text.includes("Answer A"))
      )
      expect(answerAMessages.length).toBeGreaterThan(0)
      expect(answerAMessages.every(m => m.delegation_item_id === "del-A")).toBe(true)

      // Answer B must be delivered to del-B and NOT del-A
      const answerBMessages = wire.sentMessages.filter(
        (m): m is Extract<LiveClientMessage, { type: "delegation.context.append" }> =>
          m.type === "delegation.context.append" && m.channel === 'speakable' && m.content.some(c => c.text.includes("Answer B"))
      )
      expect(answerBMessages.length).toBeGreaterThan(0)
      expect(answerBMessages.every(m => m.delegation_item_id === "del-B")).toBe(true)

      // Both receipts must be replied
      const receiptA = events.filter(e => e.type === "task-receipt" && e.receipt.id === "del-A").at(-1)?.receipt
      const receiptB = events.filter(e => e.type === "task-receipt" && e.receipt.id === "del-B").at(-1)?.receipt
      expect(receiptA?.status).toBe("replied")
      expect(receiptB?.status).toBe("replied")
    } finally {
      await call.close()
    }
  })
})
