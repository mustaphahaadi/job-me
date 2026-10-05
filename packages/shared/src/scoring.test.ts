import { describe, it, expect } from 'vitest';
import { scoreJob } from './scoring';
import type { NormalizedJob } from './types';

describe('scoreJob', () => {
  const baseJob: NormalizedJob = {
    title: 'Senior Cloud Engineer',
    company: 'Acme Cloud',
    description: 'Looking for a Senior Cloud Engineer with experience in AWS, Terraform, Kubernetes, and CI/CD pipelines.',
    url: 'https://example.com/job/1',
    posted_date: new Date().toISOString(),
    raw_location: 'Remote, UK',
    raw_tags: ['aws', 'terraform'],
  };

  it('calculates a high match score for matching title and skills', () => {
    const result = scoreJob(baseJob, {
      targetRoles: ['Cloud Engineer', 'DevOps Engineer'],
      negativeKeywords: ['php', 'wordpress'],
      acceptedLocations: ['Remote', 'UK'],
      targetSeniority: 'senior',
    });

    expect(result.score).toBeGreaterThan(0.7);
    expect(result.breakdown.negative_keyword_hit).toBe(false);
    expect(result.breakdown.title_match.score).toBeGreaterThan(0.5);
  });

  it('forces score to 0 when negative keyword matches', () => {
    const jobWithNegative: NormalizedJob = {
      ...baseJob,
      description: 'Role requires legacy PHP and WordPress maintenance.',
    };

    const result = scoreJob(jobWithNegative, {
      targetRoles: ['Cloud Engineer'],
      negativeKeywords: ['php'],
    });

    expect(result.score).toBe(0);
    expect(result.breakdown.negative_keyword_hit).toBe(true);
    expect(result.breakdown.negative_keywords_found).toContain('php');
  });

  it('scores Ghana on-site and remote jobs with highest priority (1.0 location score)', () => {
    const ghanaJob: NormalizedJob = {
      ...baseJob,
      title: 'DevOps Engineer',
      raw_location: 'Accra, Ghana',
    };

    const result = scoreJob(ghanaJob, {
      targetRoles: ['DevOps Engineer'],
      acceptedLocations: ['Ghana', 'Accra'],
    });

    expect(result.breakdown.location.accepted).toBe(true);
    expect(result.breakdown.location.score).toBe(1.0);
  });
});
