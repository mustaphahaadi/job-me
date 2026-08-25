import type { Source, NormalizedJob } from '@job-me/shared';

/**
 * All source connectors implement this interface.
 * One module per source type (rss, api) — adding a new source type = adding a connector, not editing a monolith.
 */
export interface Connector {
  /** Fetches jobs from a source and returns normalized job objects. */
  fetch(source: Source): Promise<NormalizedJob[]>;
}
