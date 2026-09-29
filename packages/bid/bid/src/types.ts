/**
 * Pure types of the bid domain: the ONE home of the bid session-event and
 * projection-key declarations, the domain payload types, and the central bid
 * REST client contract, free of host-side value imports (cordis Service,
 * schemastery). Two namespace projections serve it — `./types` for host
 * consumers, `./client` (the browser half-entry's re-export) for client
 * aggregates — with zero content duplication.
 *
 * @module @deepseek-ai/dsh-bid/types
 */

// Side-effect type imports force resolution of the two augmented modules so the
// composite build redirects to their declaration output; without them the
// `declare module` augmentations below hit TS6305. This is the same pattern
// tool-todo uses to resolve the session-projection service declaration.
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-session-projection/types'

/** Stable identifier of a tender in the central bid service. */
export type TenderId = Branded<'TenderId'>

/** Stable identifier of a tender section in the central bid service. */
export type SectionId = Branded<'SectionId'>

/** Stable identifier of a produced bid export in the central bid service. */
export type BidExportId = Branded<'BidExportId'>

/** An ordered reference to one top-level tender section. */
export interface BidTenderSectionRef {
  /** Stable identifier of the referenced section. */
  sectionId: SectionId
  /** Human-readable section title. */
  title: string
}

/** A parsed tender's summary — the unit of the `bid/tender-loaded` snapshot. */
export interface BidTender {
  /** Stable identifier of the tender in the central bid service. */
  tenderId: TenderId
  /** Human-readable tender title shown in the conversation card. */
  title: string
  /** Ordered top-level section references; absent only on pre-manifest bid events. */
  sections?: BidTenderSectionRef[]
  /** Number of top-level sections; equals `sections.length` when the manifest is present. */
  sectionCount: number
}

/** One section of a tender's technical-bid outline and its writing state. */
export interface BidSection {
  /** Tender that owns this generated section; absent only on pre-ownership bid events. */
  tenderId?: TenderId
  /** Stable identifier of the section in the central bid service. */
  sectionId: SectionId
  /** Human-readable section title. */
  title: string
  /** Writing lifecycle state. */
  status: 'draft' | 'reviewed' | 'final'
}

/** A capability-match result against one tender. */
export interface BidMatch {
  /** The tender this match is against. */
  tenderId: TenderId
  /** Count of requirements the enterprise archive can satisfy. */
  matched: number
  /** Count of requirements with no matching capability. */
  gaps: number
  /** Human-readable risk notes for the gaps and weak matches. */
  risks: string[]
}

/** A produced export artifact for one tender's technical bid. */
export interface BidExport {
  /** Tender that owns this export artifact; absent only on pre-ownership bid events. */
  tenderId?: TenderId
  /** Stable identifier of the export in the central bid service. */
  exportId: BidExportId
  /** Workspace-relative path of the produced DOCX. */
  docxPath: string
  /** Page count of the produced document. */
  pages: number
}

/** A bounded byte source for parsing one tender document. */
/** New-service tender summary with its required manifest. */
export type CurrentBidTender = BidTender & { sections: BidTenderSectionRef[] }
/** New-service generated section with required tender ownership. */
export type CurrentBidSection = BidSection & { tenderId: TenderId }
/** New-service export artifact with required tender ownership. */
export type CurrentBidExport = BidExport & { tenderId: TenderId }

/** Request to produce and transfer one bid export into its owning Session workspace. */
export interface BidExportRequest {
  /** Tender whose generated content is exported. */
  tenderId: TenderId
  /** Session whose workspace receives the downloaded DOCX; it must have a workspace cwd. */
  session: Session
  /** Workspace-relative destination for the DOCX. */
  destination: string
}

/** Streamed tender document submitted to the central parser. */
export interface BidParseTenderRequest {
  /** Human-readable tender title. */
  title: string
  /** Display filename sent to the central parser. */
  name: string
  /** Exact number of bytes the source must yield. */
  bytes: number
  /** Exact file bytes in order; producers must not buffer the whole document. */
  data: AsyncIterable<Uint8Array>
  /** Owning session ID attached to the created project for bidirectional navigation. */
  sessionId?: SessionId | undefined
}

/**
 * The central bid REST service contract. The HTTP-backed `ctx.bid` service
 * implements it; tool and command consumers depend on this interface so a test
 * composition can serve it from a local mock without a live central server.
 */
/** Structured generation guidance prepared for one tender section. */
export interface BidSectionBrief {
  /** Section manifest identity this guidance covers. */
  sectionId: SectionId
  /** Concise generation strategy for the central bid service. */
  strategy: string
  /** Ordered tender requirements the generated text must address. */
  requirements: string[]
}

/** Request for one central-service section generation. */
export interface BidGenerateSectionRequest {
  /** Tender that owns the section. */
  tenderId: TenderId
  /** Section selected from the parsed manifest. */
  sectionId: SectionId
  /** Optional subagent-authored generation guidance. */
  brief?: BidSectionBrief
}

/** Persistent project summary returned by the central bidding service. */
export interface BidProjectSummary {
  /** Central project identity. */
  projectId: string
  /** Human-readable project title. */
  title: string
  /** Session that owns the active DSH conversation when one is linked. */
  sessionId?: SessionId | undefined
  /** Current project lifecycle status. */
  status: 'parsed' | 'matching' | 'generating' | 'ready' | 'exported' | 'failed'
  /** Number of sections currently completed. */
  completedSections: number
  /** Total section count from the parsed tender manifest. */
  totalSections: number
  /** ISO-8601 timestamp of the latest central project update. */
  updatedAt: string
}

/** Central bidding service operations consumed by tools, commands, and Host UI adapters. */
export interface BidClient {
  /**
   * Parse a tender document and return its structured summary.
   * @param request - the tender title, filename, exact byte count, and streaming byte source.
   * @param signal - optional caller cancellation of the request.
   * @returns the parsed tender summary.
   */
  parseTender(request: BidParseTenderRequest, signal?: AbortSignal): Promise<CurrentBidTender>
  /**
   * Match the enterprise archive against one tender's requirements.
   * @param request - the tender to match.
   * @param signal - optional caller cancellation of the request.
   * @returns the match counts and risk notes.
   */
  matchCapabilities(request: { tenderId: TenderId }, signal?: AbortSignal): Promise<BidMatch>
  /**
   * Generate one technical-bid section for a tender.
   * @param request - the tender and section to generate.
   * @param signal - optional caller cancellation of the request.
   * @returns the generated section in `draft` state.
   */
  generateSection(request: BidGenerateSectionRequest, signal?: AbortSignal): Promise<CurrentBidSection>
  /**
   * Export a tender's technical bid as a formatted DOCX.
   * @param request - the tender to export.
   * @param signal - optional caller cancellation of the request.
   * @returns the produced export artifact.
   */
  exportBid(request: BidExportRequest, signal?: AbortSignal): Promise<CurrentBidExport>
  /**
   * List persistent bid projects visible to the delegated caller.
   * @param signal - optional caller cancellation of the request.
   * @returns central project summaries ordered by latest update.
   */
  listProjects(signal?: AbortSignal): Promise<BidProjectSummary[]>
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** A tender was parsed and loaded; latest load wins on replay. */
    'bid/tender-loaded': { tender: BidTender }
    /** Capabilities were matched against the loaded tender; latest match wins. */
    'bid/capability-matched': { match: BidMatch }
    /** A technical-bid section was generated or revised; folds into the outline. */
    'bid/section-generated': { section: BidSection }
    /** A tender's technical bid was exported; latest export wins. */
    'bid/export-produced': { artifact: BidExport }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    bidTender: BidTender | null
    bidOutline: BidSection[] | null
    bidMatch: BidMatch | null
  }
  interface SessionProjectionMap {
    /** The most recently loaded tender, or `null` before the first load. */
    bidTender: BidTender | null
    /** The tender outline: every generated section, latest per sectionId, or `null` before the first. */
    bidOutline: BidSection[] | null
    /** The most recent capability match, or `null` before the first match. */
    bidMatch: BidMatch | null
  }
}
