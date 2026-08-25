import { useState, useEffect, useCallback } from 'react';
import type { Job, JobStatus, Source, CvVersion } from '@job-me/shared';
import { supabase } from '../lib/supabase';
import { PipelineSidebar } from '../components/PipelineSidebar';
import { FilterBar, type FilterState } from '../components/FilterBar';
import { JobCard } from '../components/JobCard';
import { JobDetailDrawer } from '../components/JobDetailDrawer';
import styles from './Dashboard.module.css';

const DEFAULT_FILTERS: FilterState = {
  sourceIds: [],
  roleKeyword: '',
  maxDaysOld: 14,
  minMatchScore: 0,
  sortBy: 'scraped_at',
};

function applyFilters(jobs: Job[], filters: FilterState, activeStatus: JobStatus | null): Job[] {
  let out = [...jobs];

  if (activeStatus !== null) {
    out = out.filter(j => j.status === activeStatus);
  }

  if (filters.sourceIds.length > 0) {
    out = out.filter(j => j.source_id && filters.sourceIds.includes(j.source_id));
  }

  if (filters.roleKeyword.trim()) {
    const kw = filters.roleKeyword.toLowerCase();
    out = out.filter(j =>
      j.title.toLowerCase().includes(kw) ||
      (j.company ?? '').toLowerCase().includes(kw)
    );
  }

  if (filters.maxDaysOld < 90) {
    const cutoff = Date.now() - filters.maxDaysOld * 86400_000;
    out = out.filter(j => {
      if (!j.posted_date) return true;
      return new Date(j.posted_date).getTime() >= cutoff;
    });
  }

  if (filters.minMatchScore > 0) {
    out = out.filter(j => (j.match_score ?? 0) >= filters.minMatchScore);
  }

  // Sort
  out.sort((a, b) => {
    switch (filters.sortBy) {
      case 'posted_date':
        return (b.posted_date ?? '').localeCompare(a.posted_date ?? '');
      case 'match_score':
        return (b.match_score ?? 0) - (a.match_score ?? 0);
      case 'days_old': {
        const aAge = a.posted_date ? Date.now() - new Date(a.posted_date).getTime() : -1;
        const bAge = b.posted_date ? Date.now() - new Date(b.posted_date).getTime() : -1;
        return aAge - bAge;
      }
      default:
        return (b.scraped_at ?? '').localeCompare(a.scraped_at ?? '');
    }
  });

  return out;
}

function buildCounts(jobs: Job[]): Partial<Record<JobStatus, number>> {
  const counts: Partial<Record<JobStatus, number>> = {};
  for (const job of jobs) {
    counts[job.status] = (counts[job.status] ?? 0) + 1;
  }
  return counts;
}

/**
 * Dashboard page (/) — main application view.
 * Pipeline sidebar + filter bar + job list + detail drawer.
 * Supabase realtime subscription keeps job counts live.
 */
export default function Dashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [cvVersions, setCvVersions] = useState<CvVersion[]>([]);
  const [activeStatus, setActiveStatus] = useState<JobStatus | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Initial load ──────────────────────────────────────────────
  useEffect(() => {
    void (async () => {
      setLoading(true);
      const [jobsRes, sourcesRes, cvRes] = await Promise.all([
        supabase.from('jobs').select('*').order('scraped_at', { ascending: false }),
        supabase.from('sources').select('*').order('name'),
        supabase.from('cv_versions').select('*').order('uploaded_at', { ascending: false }),
      ]);
      if (jobsRes.data) setJobs(jobsRes.data as Job[]);
      if (sourcesRes.data) setSources(sourcesRes.data as Source[]);
      if (cvRes.data) setCvVersions(cvRes.data as CvVersion[]);
      setLoading(false);
    })();
  }, []);

  // ── Realtime subscription ─────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel('jobs-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, payload => {
        setJobs(prev => {
          if (payload.eventType === 'INSERT') {
            return [payload.new as Job, ...prev];
          }
          if (payload.eventType === 'UPDATE') {
            const updated = payload.new as Job;
            return prev.map(j => j.id === updated.id ? updated : j);
          }
          if (payload.eventType === 'DELETE') {
            return prev.filter(j => j.id !== (payload.old as Job).id);
          }
          return prev;
        });
      })
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, []);

  // ── Actions ───────────────────────────────────────────────────

  const handleMarkApplied = useCallback(async (jobId: string) => {
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;
    const cv = cvVersions[0];
    await supabase.from('jobs').update({ status: 'matched' }).eq('id', jobId); // will transition on next pass
    await supabase.from('applications').insert({
      job_id: jobId,
      method: 'manual',
      cv_version_id: job.cv_version_id ?? cv?.id ?? null,
    });
    await supabase.from('jobs').update({ status: 'auto_applied' }).eq('id', jobId);
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'auto_applied' } : j));
    setSelectedJob(prev => prev?.id === jobId ? { ...prev, status: 'auto_applied' } : prev);
  }, [jobs, cvVersions]);

  const handleDismiss = useCallback(async (jobId: string) => {
    await supabase.from('jobs').update({ status: 'closed' }).eq('id', jobId);
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'closed' } : j));
    setSelectedJob(prev => prev?.id === jobId ? { ...prev, status: 'closed' } : prev);
  }, []);

  const handleRequeue = useCallback(async (jobId: string) => {
    await supabase.from('jobs').update({
      status: 'matched',
      auto_apply_result: null,
      auto_apply_error: null,
    }).eq('id', jobId);
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'matched', auto_apply_result: null } : j));
    setSelectedJob(prev => prev?.id === jobId ? { ...prev, status: 'matched', auto_apply_result: null } : prev);
  }, []);

  const handleSwapCv = useCallback(async (jobId: string, cvVersionId: string) => {
    await supabase.from('jobs').update({ cv_version_id: cvVersionId || null }).eq('id', jobId);
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, cv_version_id: cvVersionId || null } : j));
    setSelectedJob(prev => prev?.id === jobId ? { ...prev, cv_version_id: cvVersionId || null } : prev);
  }, []);

  // ── Derived data ──────────────────────────────────────────────

  const filteredJobs = applyFilters(jobs, filters, activeStatus);
  const counts = buildCounts(jobs);

  const sourceMap = Object.fromEntries(sources.map(s => [s.id, s.name]));

  return (
    <div className={styles.layout}>
      <PipelineSidebar
        activeStatus={activeStatus}
        counts={counts}
        onSelect={setActiveStatus}
      />

      <div className={styles.main}>
        <FilterBar sources={sources} filters={filters} onChange={setFilters} />

        <div className={styles.jobList}>
          {loading ? (
            <div className={styles.emptyState}>Loading jobs…</div>
          ) : filteredJobs.length === 0 ? (
            <div className={styles.emptyState} id="dashboard-empty-state">
              {activeStatus === 'manual_queue'
                ? 'Nothing waiting on you. New unmatched jobs will land here.'
                : 'No jobs match these filters. Try widening the days-old range or clearing a filter.'}
            </div>
          ) : (
            filteredJobs.map(job => (
              <JobCard
                key={job.id}
                job={job}
                sourceName={job.source_id ? sourceMap[job.source_id] : undefined}
                isSelected={selectedJob?.id === job.id}
                onClick={setSelectedJob}
              />
            ))
          )}
        </div>
      </div>

      <JobDetailDrawer
        job={selectedJob}
        cvVersions={cvVersions}
        sourceName={selectedJob?.source_id ? sourceMap[selectedJob.source_id] : undefined}
        onClose={() => setSelectedJob(null)}
        onMarkApplied={handleMarkApplied}
        onDismiss={handleDismiss}
        onRequeue={handleRequeue}
        onSwapCv={handleSwapCv}
      />
    </div>
  );
}
