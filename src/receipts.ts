export type LiveTaskStatus =
  | 'queued'
  | 'running'
  | 'replied'
  | 'no-reply'
  | 'cancelled'
  | 'blocked'
  | 'interrupted'
  | 'max-tokens'
  | 'discarded'
  | 'failed'
  | 'tracking-stopped'

export type LiveTaskRequestKind = 'new' | 'additional'

export type LiveTaskRoute = 'followup' | 'steer'

export interface LiveTaskReceipt {
  readonly id: string
  readonly input: string
  readonly handoff: string
  readonly context: readonly { role: 'user' | 'assistant'; text: string }[]
  readonly requestKind: LiveTaskRequestKind
  readonly route: LiveTaskRoute
  readonly status: LiveTaskStatus
  readonly createdAt: number
  readonly updatedAt: number
  readonly claimedTurn?: number
  readonly error?: string
}

type ReceiptRecord = {
  receipt: LiveTaskReceipt
  messageId: string
}

const MAX_RECENT_SETTLED_RECEIPTS = 24

function isActive(status: LiveTaskStatus): boolean {
  return status === 'queued' || status === 'running'
}

export class LiveTaskReceiptLog {
  private readonly records = new Map<string, ReceiptRecord>()
  private readonly receiptIdByMessageId = new Map<string, string>()

  has(id: string): boolean {
    return this.records.has(id)
  }

  create(input: {
    id: string
    messageId: string
    taskInput: string
    handoff: string
    context: LiveTaskReceipt['context']
    requestKind: LiveTaskRequestKind
    route: LiveTaskRoute
    now?: number
  }): LiveTaskReceipt {
    const existing = this.records.get(input.id)
    if (existing) return existing.receipt
    const now = input.now ?? Date.now()
    const receipt: LiveTaskReceipt = {
      id: input.id,
      input: input.taskInput,
      handoff: input.handoff,
      context: input.context.map(line => ({ ...line })),
      requestKind: input.requestKind,
      route: input.route,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    }
    this.records.set(receipt.id, { receipt, messageId: input.messageId })
    this.receiptIdByMessageId.set(input.messageId, receipt.id)
    return receipt
  }

  claimed(messageId: string, turn: number, now?: number): LiveTaskReceipt | undefined {
    const id = this.receiptIdByMessageId.get(messageId)
    if (id === undefined) return undefined
    if (this.records.get(id)?.receipt.status !== 'queued') return undefined
    return this.update(id, {
      status: 'running',
      claimedTurn: turn,
      updatedAt: now ?? Date.now(),
    })
  }

  discarded(messageId: string, now?: number): LiveTaskReceipt | undefined {
    const id = this.receiptIdByMessageId.get(messageId)
    if (id === undefined) return undefined
    const status = this.records.get(id)?.receipt.status
    if (status !== 'queued' && status !== 'running') return undefined
    return this.update(id, { status: 'discarded', updatedAt: now ?? Date.now() })
  }

  ended(input: {
    turn: number
    status: Extract<LiveTaskStatus, 'replied' | 'no-reply' | 'cancelled' | 'blocked' | 'interrupted' | 'max-tokens' | 'failed'>
    error?: string
    now?: number
  }): LiveTaskReceipt[] {
    const changed: LiveTaskReceipt[] = []
    for (const { receipt } of this.records.values()) {
      if (receipt.status !== 'running' || receipt.claimedTurn !== input.turn) continue
      const next = this.update(receipt.id, {
        status: input.status,
        ...input.error === undefined ? {} : { error: input.error },
        updatedAt: input.now ?? Date.now(),
      })
      if (next) changed.push(next)
    }
    return changed
  }

  failed(id: string, error: string, now?: number): LiveTaskReceipt | undefined {
    if (this.records.get(id)?.receipt.status !== 'queued') return undefined
    return this.update(id, {
      status: 'failed',
      error,
      updatedAt: now ?? Date.now(),
    })
  }

  stopTracking(now?: number): LiveTaskReceipt[] {
    const changed: LiveTaskReceipt[] = []
    for (const { receipt } of this.records.values()) {
      if (!isActive(receipt.status)) continue
      const next = this.update(receipt.id, {
        status: 'tracking-stopped',
        updatedAt: now ?? Date.now(),
      })
      if (next) changed.push(next)
    }
    return changed
  }

  snapshot(): readonly LiveTaskReceipt[] {
    return [...this.records.values()]
      .map(record => record.receipt)
      .sort((left, right) => left.createdAt - right.createdAt)
  }

  private update(id: string, patch: Partial<LiveTaskReceipt>): LiveTaskReceipt | undefined {
    const record = this.records.get(id)
    if (!record) return undefined
    const receipt = { ...record.receipt, ...patch }
    this.records.set(id, { ...record, receipt })
    this.pruneSettled()
    return receipt
  }

  private pruneSettled(): void {
    const settled = [...this.records.values()]
      .filter(record => !isActive(record.receipt.status))
      .sort((left, right) => left.receipt.updatedAt - right.receipt.updatedAt)
    for (const record of settled.slice(0, Math.max(0, settled.length - MAX_RECENT_SETTLED_RECEIPTS))) {
      this.records.delete(record.receipt.id)
      this.receiptIdByMessageId.delete(record.messageId)
    }
  }
}

export function mergeLiveTaskReceipt(
  receipts: readonly LiveTaskReceipt[],
  incoming: LiveTaskReceipt,
): readonly LiveTaskReceipt[] {
  const next = receipts.filter(receipt => receipt.id !== incoming.id)
  next.push(incoming)
  next.sort((left, right) => left.createdAt - right.createdAt)
  const settled = next.filter(receipt => !isActive(receipt.status))
  const remove = new Set(
    settled
      .sort((left, right) => left.updatedAt - right.updatedAt)
      .slice(0, Math.max(0, settled.length - MAX_RECENT_SETTLED_RECEIPTS))
      .map(receipt => receipt.id),
  )
  return next.filter(receipt => !remove.has(receipt.id))
}

export function stopTrackingLiveTaskReceipts(
  receipts: readonly LiveTaskReceipt[],
  now = Date.now(),
): readonly LiveTaskReceipt[] {
  return receipts.map(receipt => isActive(receipt.status)
    ? { ...receipt, status: 'tracking-stopped', updatedAt: now }
    : receipt)
}
