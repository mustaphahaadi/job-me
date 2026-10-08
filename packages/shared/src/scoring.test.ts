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

  it('rejects foreign on-site jobs (score = 0 and location.accepted = false)', () => {
    const foreignOnsiteJob: NormalizedJob = {
      ...baseJob,
      title: 'DevOps Engineer',
      raw_location: 'London, United Kingdom',
      description: 'Onsite position in central London office.',
    };

    const result = scoreJob(foreignOnsiteJob, {
      targetRoles: ['DevOps Engineer'],
      acceptedLocations: ['Ghana', 'remote'],
    });

    expect(result.breakdown.location.accepted).toBe(false);
    expect(result.score).toBe(0);
  });

  it('accepts foreign remote jobs (location.accepted = true and high score)', () => {
    const foreignRemoteJob: NormalizedJob = {
      ...baseJob,
      title: 'DevOps Engineer (Remote)',
      raw_location: 'London, United Kingdom',
      description: 'Fully remote position for candidates worldwide with AWS, Terraform, and Kubernetes experience.',
    };

    const result = scoreJob(foreignRemoteJob, {
      targetRoles: ['DevOps Engineer'],
      acceptedLocations: ['Ghana', 'remote'],
    });

    expect(result.breakdown.location.accepted).toBe(true);
    expect(result.score).toBeGreaterThan(0.40);
  });

  // ── Regression tests: scoring false-positive fixes ──────────────────────

  it('scores an irrelevant job title with target roles to 0 (no generic alias boost)', () => {
    const irrelevantJob: NormalizedJob = {
      ...baseJob,
      title: 'HR Manager',
      description: 'We use agile practices and care about testing. Remote role worldwide.',
      raw_location: 'Remote',
    };

    const result = scoreJob(irrelevantJob, {
      targetRoles: ['Cloud Engineer', 'DevOps Engineer'],
      acceptedLocations: ['remote', 'worldwide'],
    });

    expect(result.breakdown.title_match.score).toBe(0);
    expect(result.score).toBe(0);
  });

  it('does not match skills or negatives by substring (java vs javascript)', () => {
    const jsJob: NormalizedJob = {
      ...baseJob,
      title: 'Cloud Engineer',
      description: 'Experience with javascript, node.js and react.',
    };

    const result = scoreJob(jsJob, {
      targetRoles: ['Cloud Engineer'],
      negativeKeywords: ['java', 'php'],
      skillVocabulary: ['java', 'node.js', 'php'],
      acceptedLocations: ['remote'],
    });

    expect(result.breakdown.negative_keyword_hit).toBe(false);
    expect(result.breakdown.skills_overlap.matched_skills).toEqual(['node.js']);
  });

  it('does not detect seniority from substrings (middle -> mid)', () => {
    const job: NormalizedJob = {
      ...baseJob,
      title: 'Cloud Engineer',
      description: 'Hiring in the middle of the year for a generalist rotation.',
    };

    const result = scoreJob(job, {
      targetRoles: ['Cloud Engineer'],
      targetSeniority: 'mid',
      acceptedLocations: ['remote'],
    });

    expect(result.breakdown.seniority.detected_level).toBe(null);
  });

  it('treats an empty accepted-locations list as accept-all (per Settings copy)', () => {
    const londonJob: NormalizedJob = {
      ...baseJob,
      title: 'DevOps Engineer',
      raw_location: 'London, United Kingdom',
      description: 'On-site in London with AWS and Terraform.',
    };

    const result = scoreJob(londonJob, {
      targetRoles: ['DevOps Engineer'],
      acceptedLocations: [],
    });

    expect(result.breakdown.location.accepted).toBe(true);
    expect(result.breakdown.location.score).toBe(0.8);
    expect(result.score).toBeGreaterThan(0);
  });

  it('rejects remote jobs when remote is not in accepted locations', () => {
    const remoteJob: NormalizedJob = {
      ...baseJob,
      title: 'DevOps Engineer',
      raw_location: 'Remote',
      description: 'Fully remote role with AWS.',
    };

    const result = scoreJob(remoteJob, {
      targetRoles: ['DevOps Engineer'],
      acceptedLocations: ['ghana', 'accra'],
    });

    expect(result.breakdown.location.accepted).toBe(false);
    expect(result.score).toBe(0);
  });

  it('matches SRE titles against the Site Reliability Engineer role via initialism', () => {
    const sreJob: NormalizedJob = {
      ...baseJob,
      title: 'SRE',
      description: 'Kubernetes, Prometheus and on-call rotations.',
      raw_location: 'Remote',
    };

    const result = scoreJob(sreJob, {
      targetRoles: ['Cloud Engineer', 'Site Reliability Engineer'],
      acceptedLocations: ['remote'],
    });

    expect(result.breakdown.title_match.score).toBe(1.0);
    expect(result.score).toBeGreaterThan(0.40);
  });
});
