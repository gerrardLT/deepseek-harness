/** Host-owned Remote facade for central bid project discovery. */
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { BidProjectSummary } from '@deepseek-ai/dsh-bid'
import type {} from '@deepseek-ai/dsh-bid'

/** Host service backing the generated `ctx.remote.bidProjects` namespace. */
export default class BidClientService extends TypertRemoteService {
  static inject = ['typert', 'bid']

  /** @param ctx - Host context containing the central bid client. */
  constructor(ctx: Context) {
    super(ctx, 'bidClient', { namespace: 'bidProjects' })
  }

  /**
   * List central bid projects without exposing the Python service to the browser.
   * @param signal - caller cancellation propagated to the central service.
   * @returns project summaries ordered by the central service.
   */
  @Remote('list')
  list(signal: AbortSignal): Promise<BidProjectSummary[]> {
    return this.ctx.bid.listProjects(signal)
  }
}
