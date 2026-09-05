import { describe, expect, it } from 'vitest'
import { MessageId } from '@deepseek-ai/dsh-llm'
import { LiveDelegations } from '../src/live-delegations.ts'

describe('claim-correlated reply collection', () => {
  it('preserves ordered replies, ignores duplicate events and unrelated claims', () => {
    const jobs = new LiveDelegations()
    jobs.create('A', MessageId('A'))
    jobs.claim(MessageId('other'), 1)
    jobs.reply(1, 1, 'unrelated')
    jobs.claim(MessageId('A'), 2)
    jobs.reply(2, 2, 'one')
    jobs.reply(2, 2, 'one')
    jobs.reply(2, 3, 'two')
    expect(jobs.end(1)).toEqual([])
    expect(jobs.end(2)).toEqual([{ liveId: 'A', text: 'one\n\ntwo' }])
    expect(jobs.end(2)).toEqual([])
    expect(jobs.active).toBe(false)
  })

  it('ends A while B is pending, without carrying A into B turn', () => {
    const jobs = new LiveDelegations()
    jobs.create('A', MessageId('A'))
    jobs.claim(MessageId('A'), 1)
    jobs.create('B', MessageId('B'))
    jobs.reply(1, 1, 'answer A')
    expect(jobs.end(1)).toEqual([{ liveId: 'A', text: 'answer A' }])
    expect(jobs.active).toBe(true)
    jobs.claim(MessageId('B'), 2)
    expect(jobs.commentaryAudience(2)).toEqual(['B'])
    jobs.reply(2, 2, 'answer B')
    expect(jobs.end(2)).toEqual([{ liveId: 'B', text: 'answer B' }])
  })

  it('labels a response shared when both requests were claimed before it', () => {
    const jobs = new LiveDelegations()
    for (const id of ['A', 'B']) {
      jobs.create(id, MessageId(id))
      jobs.claim(MessageId(id), 1)
    }
    jobs.reply(1, 1, 'combined answer')
    const replies = jobs.end(1)
    expect(replies.map(reply => reply.liveId)).toEqual(['A', 'B'])
    expect(replies[0].text).toContain('Shared worker response')
    expect(replies[0].text).toBe(replies[1].text)
  })

  it('removes a discarded request without reassigning its answer', () => {
    const jobs = new LiveDelegations()
    jobs.create('A', MessageId('A'))
    jobs.create('B', MessageId('B'))
    jobs.claim(MessageId('A'), 1)
    jobs.discard(MessageId('B'))
    jobs.reply(1, 1, 'answer A')
    expect(jobs.end(1)).toEqual([{ liveId: 'A', text: 'answer A' }])
    expect(jobs.active).toBe(false)
  })
})
