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
    expect(result.breakdown.skills_overlap.description_available).toBe(true);
  });

  it('keeps jobs without a description eligible for auto-apply (neutral skills signal)', () => {
    const noDescriptionJob: NormalizedJob = {
      ...baseJob,
      description: null,
      raw_location: 'Remote',
    };

    const result = scoreJob(noDescriptionJob, {
      targetRoles: ['Cloud Engineer'],
      acceptedLocations: ['remote'],
      targetSeniority: 'senior',
    });

    expect(result.breakdown.skills_overlap.description_available).toBe(false);
    expect(result.breakdown.skills_overlap.score).toBe(0.5);
    expect(result.score).toBeGreaterThan(0.75);
  });

  it('treats invalid and future posted dates as neutral instead of producing NaN or >1', () => {
    const invalidDateJob: NormalizedJob = {
      ...baseJob,
      posted_date: 'not-a-real-date',
    };
    const futureDateJob: NormalizedJob = {
      ...baseJob,
      posted_date: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    };

    const invalid = scoreJob(invalidDateJob, {
      targetRoles: ['Cloud Engineer'],
      acceptedLocations: ['remote'],
    });
    const future = scoreJob(futureDateJob, {
      targetRoles: ['Cloud Engineer'],
      acceptedLocations: ['remote'],
    });

    expect(Number.isNaN(invalid.score)).toBe(false);
    expect(invalid.breakdown.recency.score).toBe(0.5);
    expect(future.breakdown.recency.score).toBe(0.5);
    expect(future.breakdown.recency.days_old).toBe(-1);
    expect(future.score).toBeLessThanOrEqual(1);
  });

  it('does not treat a location containing a Ghana keyword as a substring as Ghana', () => {
    const temasekJob: NormalizedJob = {
      ...baseJob,
      title: 'DevOps Engineer',
      raw_location: 'Temasek, Singapore',
      description: 'Fully remote role with AWS and Kubernetes.',
    };

    const result = scoreJob(temasekJob, {
      targetRoles: ['DevOps Engineer'],
      acceptedLocations: ['remote'],
    });

    expect(result.breakdown.location.accepted).toBe(true);
    expect(result.breakdown.location.score).toBe(0.95);
  });

  it('does not detect seniority from a generic mention in the description', () => {
    const job: NormalizedJob = {
      ...baseJob,
      title: 'Cloud Engineer',
      description: 'You will collaborate with senior engineers across the platform team.',
    };

    const result = scoreJob(job, {
      targetRoles: ['Cloud Engineer'],
      targetSeniority: 'mid',
      acceptedLocations: ['remote'],
    });

    expect(result.breakdown.seniority.detected_level).toBe(null);
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

  it('rejects foreign on-site jobs (e.g. South Africa, London) even with empty accepted-locations list', () => {
    const johannesburgOnsiteJob: NormalizedJob = {
      ...baseJob,
      title: 'Site Reliability Engineer',
      raw_location: 'Johannesburg, Gauteng, South Africa',
      description: 'On-site position in central Johannesburg office.',
    };

    const result = scoreJob(johannesburgOnsiteJob, {
      targetRoles: ['Site Reliability Engineer'],
      acceptedLocations: [],
    });

    expect(result.breakdown.location.accepted).toBe(false);
    expect(result.score).toBe(0);
  });

  it('rejects South Africa on-site jobs even when South Africa is in accepted locations', () => {
    const saOnsiteJob: NormalizedJob = {
      ...baseJob,
      title: 'Site Reliability Engineer',
      raw_location: 'Johannesburg, Gauteng, South Africa',
      description: 'Onsite role supporting infrastructure.',
    };

    const result = scoreJob(saOnsiteJob, {
      targetRoles: ['Site Reliability Engineer'],
      acceptedLocations: ['South Africa', 'Johannesburg', 'remote'],
    });

    expect(result.breakdown.location.accepted).toBe(false);
    expect(result.score).toBe(0);
  });

  it('rejects South Africa hybrid jobs', () => {
    const saHybridJob: NormalizedJob = {
      ...baseJob,
      title: 'Site Reliability Engineer (Hybrid)',
      raw_location: 'Johannesburg, South Africa',
      description: 'Hybrid position: 3 days in office, 2 days remote.',
    };

    const result = scoreJob(saHybridJob, {
      targetRoles: ['Site Reliability Engineer'],
      acceptedLocations: ['South Africa', 'remote'],
    });

    expect(result.breakdown.location.accepted).toBe(false);
    expect(result.score).toBe(0);
  });

  it('does not treat "Hybrid Cloud" in a title as an on-site indicator', () => {
    const hybridCloudJob: NormalizedJob = {
      ...baseJob,
      title: 'Hybrid Cloud Engineer',
      raw_location: 'Remote',
      description: 'Build hybrid cloud platforms with AWS and Kubernetes.',
    };

    const result = scoreJob(hybridCloudJob, {
      targetRoles: ['Cloud Engineer'],
      acceptedLocations: ['remote'],
    });

    expect(result.breakdown.location.accepted).toBe(true);
    expect(result.breakdown.location.score).toBe(0.95);
  });

  it('does not treat "Distributed Systems" or "Global" in a title as remote', () => {
    const distributedJob: NormalizedJob = {
      ...baseJob,
      title: 'Distributed Systems Engineer',
      raw_location: 'London, United Kingdom',
      description: 'Build and operate distributed systems for our platform.',
    };
    const globalJob: NormalizedJob = {
      ...baseJob,
      title: 'Global Infrastructure Engineer',
      raw_location: 'London, United Kingdom',
      description: 'Manage our global infrastructure estate.',
    };

    const distributed = scoreJob(distributedJob, {
      targetRoles: ['Systems Engineer'],
      acceptedLocations: ['remote'],
    });
    const global = scoreJob(globalJob, {
      targetRoles: ['Infrastructure Engineer'],
      acceptedLocations: ['remote'],
    });

    expect(distributed.breakdown.location.accepted).toBe(false);
    expect(distributed.score).toBe(0);
    expect(global.breakdown.location.accepted).toBe(false);
    expect(global.score).toBe(0);
  });

  it('still rejects a remote title when the location explicitly says hybrid', () => {
    const hybridLocationJob: NormalizedJob = {
      ...baseJob,
      title: 'Cloud Engineer (Remote)',
      raw_location: 'London, United Kingdom (Hybrid)',
      description: 'Cloud engineering role.',
    };

    const result = scoreJob(hybridLocationJob, {
      targetRoles: ['Cloud Engineer'],
      acceptedLocations: ['remote'],
    });

    expect(result.breakdown.location.accepted).toBe(false);
    expect(result.score).toBe(0);
  });

  it('does not treat a negated remote phrase in the description as remote', () => {
    const onSiteJob: NormalizedJob = {
      ...baseJob,
      title: 'Cloud Engineer',
      raw_location: 'London, United Kingdom',
      description: 'This is not a remote position. You will work from our London office.',
    };

    const result = scoreJob(onSiteJob, {
      targetRoles: ['Cloud Engineer'],
      acceptedLocations: ['remote'],
    });

    expect(result.breakdown.location.accepted).toBe(false);
    expect(result.score).toBe(0);
  });

  it('accepts South Africa remote jobs', () => {
    const saRemoteJob: NormalizedJob = {
      ...baseJob,
      title: 'Site Reliability Engineer (Remote)',
      raw_location: 'Johannesburg, South Africa',
      description: 'Fully remote role for candidates based in South Africa.',
    };

    const result = scoreJob(saRemoteJob, {
      targetRoles: ['Site Reliability Engineer'],
      acceptedLocations: ['South Africa', 'remote'],
    });

    expect(result.breakdown.location.accepted).toBe(true);
    expect(result.breakdown.location.score).toBe(0.95);
    expect(result.score).toBeGreaterThan(0.5);
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
