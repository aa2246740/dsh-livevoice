import type { MessageId } from '@deepseek-ai/dsh-llm'

export type DelegationJob = {
  readonly liveIds: readonly string[]
  readonly pendingMessageIds: readonly MessageId[]
  readonly claimedTurn?: number
}

export type DelegationInput =
  | { type: 'created'; liveId: string; messageId: MessageId }
  | { type: 'claimed'; messageId: MessageId; turn: number }
  | { type: 'discarded'; messageId: MessageId }
  | { type: 'turn-end'; turn: number }

export type DelegationApply = {
  readonly job: DelegationJob | undefined
  readonly finalizeTurn?: number
  readonly finalizeLiveIds?: readonly string[]
}

export function applyDelegationInput(
  job: DelegationJob | undefined,
  input: DelegationInput,
): DelegationApply {
  switch (input.type) {
    case 'created':
      return { job: appendCreated(job, input.liveId, input.messageId) }
    case 'claimed':
      return { job: applyClaim(job, input.messageId, input.turn) }
    case 'discarded':
      return { job: applyDiscard(job, input.messageId) }
    case 'turn-end':
      return applyTurnEnd(job, input.turn)
  }
}

function appendCreated(
  job: DelegationJob | undefined,
  liveId: string,
  messageId: MessageId,
): DelegationJob {
  if (job === undefined) {
    return { liveIds: [liveId], pendingMessageIds: [messageId] }
  }
  return {
    liveIds: job.liveIds.includes(liveId) ? job.liveIds : [...job.liveIds, liveId],
    pendingMessageIds: job.pendingMessageIds.includes(messageId)
      ? job.pendingMessageIds
      : [...job.pendingMessageIds, messageId],
    ...job.claimedTurn === undefined ? {} : { claimedTurn: job.claimedTurn },
  }
}

function applyClaim(
  job: DelegationJob | undefined,
  messageId: MessageId,
  turn: number,
): DelegationJob | undefined {
  if (job === undefined || !job.pendingMessageIds.includes(messageId)) return job
  const pendingMessageIds = job.pendingMessageIds.filter(id => id !== messageId)
  return {
    liveIds: job.liveIds,
    pendingMessageIds,
    claimedTurn: job.claimedTurn ?? turn,
  }
}

function applyDiscard(
  job: DelegationJob | undefined,
  messageId: MessageId,
): DelegationJob | undefined {
  if (job === undefined || !job.pendingMessageIds.includes(messageId)) return job
  const pendingMessageIds = job.pendingMessageIds.filter(id => id !== messageId)
  if (pendingMessageIds.length === 0 && job.claimedTurn === undefined) return undefined
  return {
    liveIds: job.liveIds,
    pendingMessageIds,
    ...job.claimedTurn === undefined ? {} : { claimedTurn: job.claimedTurn },
  }
}

function applyTurnEnd(job: DelegationJob | undefined, turn: number): DelegationApply {
  if (job === undefined || job.claimedTurn !== turn) return { job }
  if (job.pendingMessageIds.length > 0) {
    return { job: { liveIds: job.liveIds, pendingMessageIds: job.pendingMessageIds } }
  }
  return { job: undefined, finalizeTurn: turn, finalizeLiveIds: job.liveIds }
}
