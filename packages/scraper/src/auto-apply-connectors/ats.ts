import type { AutoApplyConnector } from './base.js';
import { GreenhouseConnector } from './greenhouse.js';
import { LeverConnector } from './lever.js';
import { WorkdayConnector } from './workday.js';

/**
 * Direct ATS application domains. Matching is performed on the parsed
 * hostname, never on the full URL string: a crafted job URL like
 * `https://evil.example/?next=greenhouse.io` must not be treated as Greenhouse
 * (that would send the applicant's CV and PII to an arbitrary site).
 */
const ATS_CONNECTORS: Array<{ domains: string[]; connector: AutoApplyConnector }> = [
  {
    domains: ['greenhouse.io', 'bamboohr.com', 'breezy.hr', 'workable.com'],
    connector: new GreenhouseConnector(),
  },
  {
    domains: ['lever.co', 'ashbyhq.com', 'smartrecruiters.com'],
    connector: new LeverConnector(),
  },
  {
    domains: ['myworkdayjobs.com', 'workday.com', 'myworkday.com'],
    connector: new WorkdayConnector(),
  },
];

/** Parses an http(s) URL and returns its lowercase hostname, or null. */
export function getHostname(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** True for `example.com` and any subdomain such as `jobs.example.com`. */
export function hostMatchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Returns a direct ATS connector for this URL, or null. */
export function findAtsConnector(url: string): AutoApplyConnector | null {
  const host = getHostname(url);
  if (!host) return null;

  for (const entry of ATS_CONNECTORS) {
    if (entry.domains.some(domain => hostMatchesDomain(host, domain))) {
      return entry.connector;
    }
  }
  return null;
}
