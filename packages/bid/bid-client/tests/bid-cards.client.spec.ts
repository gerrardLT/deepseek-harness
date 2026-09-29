import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { TenderId } from '@deepseek-ai/dsh-bid/client'
import { bidEventDefinition } from '../src/client/bid-cards.tsx'

const tender = { tenderId: brandString<TenderId>('t1'), title: 'Tender', sections: [], sectionCount: 0 }
const location = { kind: 'turn', turn: { turn: 1 } }

function event(type: string, data: unknown, seq: number) {
  return { type, data, seq, time: seq } as never
}

describe('bid conversation cards', () => {
  it('correlates a raw bid event and persisted tool metadata by stable id', () => {
    const raw = event('bid/tender-loaded', { tender }, 1)
    const result = event('tool/result', { meta: { version: 1, kind: 'tender', id: 'bid:tender:t1' } }, 2)
    expect(bidEventDefinition.match(raw)).toEqual({ id: 'bid:tender:t1', role: 'start' })
    expect(bidEventDefinition.match(result)).toEqual({ id: 'bid:tender:t1', role: 'update' })
    const state = bidEventDefinition.start({} as never, { event: raw, location } as never, {} as never)
    expect(bidEventDefinition.update({ state } as never, { event: result, location } as never)).toEqual({
      kind: 'tender', tender, resultMeta: { version: 1, kind: 'tender', id: 'bid:tender:t1' },
    })
  })

  it('falls back to the raw domain card when replay metadata is malformed', () => {
    const raw = event('bid/tender-loaded', { tender }, 1)
    const state = bidEventDefinition.start({} as never, { event: raw, location } as never, {} as never)
    for (const meta of [undefined, null, { version: 2, kind: 'tender', id: 'x' }, { version: 1, kind: 'unknown', id: 'x' }, { version: 1, kind: 'tender', id: '' }]) {
      const malformed = event('tool/result', { meta }, 2)
      expect(bidEventDefinition.match(malformed)).toBeNull()
      expect(bidEventDefinition.update({ state } as never, { event: malformed, location } as never)).toBe(state)
    }
  })
})
