/**
 * Re-export of the bid domain types this tool consumes. The `bid/*` event and
 * the `bidTender`/`bidOutline`/`bidMatch` projection-key declarations live in
 * `@deepseek-ai/dsh-bid` (their one home); this face re-projects the payload
 * types so tool-bid's own root and client outlets carry them without
 * duplicating the declarations.
 *
 * @module @deepseek-ai/dsh-tool-bid/types
 */

export type {
  BidExport, BidExportId, BidMatch, BidSection, BidSectionBrief, BidTender, SectionId, TenderId,
} from '@deepseek-ai/dsh-bid'
