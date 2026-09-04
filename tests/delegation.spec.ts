import { describe, expect, it } from 'vitest'
import { MessageId } from '@deepseek-ai/dsh-llm'
import {
  applyDelegationInput,
  type DelegationJob,
} from '../src/delegation.ts'

const d1 = 'del-1'
const d2 = 'del-2'
const m1 = MessageId('msg-1')
const m2 = MessageId('msg-2')
const other = MessageId('msg-other')

function created(liveId: string, messageId: MessageId) {
  return applyDelegationInput(undefined, { type: 'created', liveId, messageId }).job
}

describe('applyDelegationInput', () => {
  it('opens a job on the first live delegation', () => {
    expect(created(d1, m1)).toEqual({ liveIds: [d1], pendingMessageIds: [m1] })
  })

  it('binds claimedTurn only for a matching pending message', () => {
    const job = created(d1, m1)
    expect(applyDelegationInput(job, { type: 'claimed', messageId: other, turn: 7 })).toEqual({ job })
    expect(applyDelegationInput(job, { type: 'claimed', messageId: m1, turn: 7 })).toEqual({
      job: { liveIds: [d1], pendingMessageIds: [], claimedTurn: 7 },
    })
  })

  it('fans a second live id onto the same job', () => {
    const job = created(d1, m1)
    expect(applyDelegationInput(job, { type: 'created', liveId: d2, messageId: m2 })).toEqual({
      job: { liveIds: [d1, d2], pendingMessageIds: [m1, m2] },
    })
  })

  it('finalizes a claimed turn with no pending messages', () => {
    let job: DelegationJob | undefined = created(d1, m1)
    job = applyDelegationInput(job, { type: 'claimed', messageId: m1, turn: 7 }).job
    expect(applyDelegationInput(job, { type: 'turn-end', turn: 8 })).toEqual({ job })
    expect(applyDelegationInput(job, { type: 'turn-end', turn: 7 })).toEqual({
      job: undefined,
      finalizeTurn: 7,
      finalizeLiveIds: [d1],
    })
  })

  it('does not finalize while a later message is still pending', () => {
    let job: DelegationJob | undefined = created(d1, m1)
    job = applyDelegationInput(job, { type: 'claimed', messageId: m1, turn: 7 }).job
    job = applyDelegationInput(job, { type: 'created', liveId: d2, messageId: m2 }).job
    expect(applyDelegationInput(job, { type: 'turn-end', turn: 7 })).toEqual({
      job: { liveIds: [d1, d2], pendingMessageIds: [m2] },
    })
  })

  it('drops a discarded pending message without failing', () => {
    let job: DelegationJob | undefined = created(d1, m1)
    job = applyDelegationInput(job, { type: 'created', liveId: d2, messageId: m2 }).job
    expect(applyDelegationInput(job, { type: 'discarded', messageId: m1 })).toEqual({
      job: { liveIds: [d1, d2], pendingMessageIds: [m2] },
    })
  })

  it('clears an unclaimed job when its last pending message is discarded', () => {
    const job = created(d1, m1)
    expect(applyDelegationInput(job, { type: 'discarded', messageId: m1 })).toEqual({ job: undefined })
  })

  it('ignores discard after the message was already claimed', () => {
    let job: DelegationJob | undefined = created(d1, m1)
    job = applyDelegationInput(job, { type: 'claimed', messageId: m1, turn: 7 }).job
    expect(applyDelegationInput(job, { type: 'discarded', messageId: m1 })).toEqual({ job })
  })
})
