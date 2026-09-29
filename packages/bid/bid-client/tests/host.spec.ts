import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { BidProjectSummary } from '@deepseek-ai/dsh-bid'
import BidClientService from '../src/index.ts'

describe('BidClientService', () => {
  it('delegates project listing to ctx.bid', async () => {
    const ctx = new Context()
    const projects: BidProjectSummary[] = []
    const listProjects = vi.fn(async () => projects)
    ctx.provide('bid', { listProjects } as never)
    const service = Object.create(BidClientService.prototype) as BidClientService
    Object.defineProperty(service, 'ctx', { value: ctx })
    const signal = new AbortController().signal
    await expect(service.list(signal)).resolves.toBe(projects)
    expect(listProjects).toHaveBeenCalledWith(signal)
  })
})
