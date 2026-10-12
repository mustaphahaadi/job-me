import type { Source, NormalizedJob, Settings } from '@job-me/shared';

/**
 * All source connectors implement this interface.
 * One module per source type (rss, api, greenhouse, ashby, lever) — adding a new source type = adding a connector.
 */
export interface Connector {
  /** Fetches jobs from a source and returns normalized job objects. */
  fetch(source: Source, settings?: Settings): Promise<NormalizedJob[]>;
}
