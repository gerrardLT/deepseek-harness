/**
 * Client-namespace projection of the bid domain: a pure re-export of the
 * package's types outlet. Client code imports ONLY the client namespace (repo
 * discipline), so `./client` projects the same single-source content `./types`
 * serves to host consumers — zero duplication. The web card package reads the
 * bid projection and event payload types through this face.
 *
 * @module @deepseek-ai/dsh-bid/client
 */

export type * from './types.ts'
