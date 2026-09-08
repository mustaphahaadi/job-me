import { useState, useEffect, useCallback } from 'react';
import { Trash2, Clock } from 'lucide-react';
import type { Job, JobStatus, Source, CvVersion } from '@job-me/shared';
import { selectCvForTitle } from '@job-me/shared';
import { supabase } from '../lib/supabase';
import { PipelineSidebar } from '../components/PipelineSidebar';
import { FilterBar, type FilterState } from '../components/FilterBar';
import { JobCard } from '../components/JobCard';
import { JobDetailDrawer } from '../components/JobDetailDrawer';
import styles from './Dashboard.module.css';

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

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
  const [deletingUnmatched, setDeletingUnmatched] = useState(false);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);

  const handleDeleteUnmatched = useCallback(async () => {
    const unmatchedJobs = jobs.filter(j => j.status === 'new' || (j.match_score ?? 0) < 0.40);
    if (unmatchedJobs.length === 0) {
      alert('No unmatched jobs found to delete.');
      return;
    }

    if (!confirm(`Are you sure you want to delete ${unmatchedJobs.length} unmatched job(s)?`)) {
      return;
    }

    setDeletingUnmatched(true);
    const unmatchedIds = unmatchedJobs.map(j => j.id);

    // Optimistically remove from UI
    setJobs(prev => prev.filter(j => !unmatchedIds.includes(j.id)));
    if (selectedJob && unmatchedIds.includes(selectedJob.id)) {
      setSelectedJob(null);
    }

    try {
      const { error } = await supabase
        .from('jobs')
        .delete()
        .in('id', unmatchedIds);
      if (error) throw error;
    } catch (err) {
      console.error('[handleDeleteUnmatched] failed:', err);
      alert('Failed to delete unmatched jobs. Refreshing...');
      const { data } = await supabase.from('jobs').select('*').order('scraped_at', { ascending: false });
      if (data) setJobs(data as Job[]);
    } finally {
      setDeletingUnmatched(false);
    }
  }, [jobs, selectedJob]);

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
      if (sourcesRes.data) {
        setSources(sourcesRes.data as Source[]);
        // Last pipeline run = most recent last_scraped_at across all sources
        const times = (sourcesRes.data as Source[])
          .map(s => s.last_scraped_at)
          .filter(Boolean) as string[];
        if (times.length > 0) setLastRunAt(times.sort().reverse()[0] ?? null);
      }
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

  /**
   * Selects the best CV for a job — uses shared selectCvForTitle so
   * manual and auto-apply paths are always consistent.
   */
  function selectCv(jobTitle: string): CvVersion | null {
    return selectCvForTitle(cvVersions, jobTitle);
  }

  const handleMarkApplied = useCallback(async (jobId: string) => {
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;
    const cv = job.cv_version_id
      ? (cvVersions.find(c => c.id === job.cv_version_id) ?? null)
      : selectCv(job.title);

    // Manual apply → 'responded' (distinct from auto_applied)
    const nextStatus: JobStatus = 'responded';

    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: nextStatus } : j));
    setSelectedJob(prev => prev?.id === jobId ? { ...prev, status: nextStatus } : prev);

    try {
      await supabase.from('applications').insert({
        job_id: jobId,
        method: 'manual',
        cv_version_id: cv?.id ?? null,
      });
      const { error } = await supabase.from('jobs')
        .update({ status: nextStatus, cv_version_id: cv?.id ?? null })
        .eq('id', jobId);
      if (error) throw error;
    } catch (err) {
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: job.status } : j));
      setSelectedJob(prev => prev?.id === jobId ? { ...prev, status: job.status } : prev);
      console.error('[handleMarkApplied] failed:', err);
      alert('Failed to mark as applied. Please try again.');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, cvVersions]);

  const handleDismiss = useCallback(async (jobId: string) => {
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;

    // Optimistic update
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'closed' } : j));
    setSelectedJob(prev => prev?.id === jobId ? { ...prev, status: 'closed' } : prev);

    try {
      const { error } = await supabase.from('jobs').update({ status: 'closed' }).eq('id', jobId);
      if (error) throw error;
    } catch (err) {
      // Revert
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: job.status } : j));
      setSelectedJob(prev => prev?.id === jobId ? { ...prev, status: job.status } : prev);
      console.error('[handleDismiss] failed:', err);
      alert('Failed to dismiss job. Please try again.');
    }
  }, [jobs]);

  const handleRequeue = useCallback(async (jobId: string) => {
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;

    // Optimistic update
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'matched', auto_apply_result: null } : j));
    setSelectedJob(prev => prev?.id === jobId ? { ...prev, status: 'matched', auto_apply_result: null } : prev);

    try {
      const { error } = await supabase.from('jobs').update({
        status: 'matched',
        auto_apply_result: null,
        auto_apply_error: null,
      }).eq('id', jobId);
      if (error) throw error;
    } catch (err) {
      // Revert
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: job.status, auto_apply_result: job.auto_apply_result } : j));
      setSelectedJob(prev => prev?.id === jobId ? { ...prev, status: job.status, auto_apply_result: job.auto_apply_result } : prev);
      console.error('[handleRequeue] failed:', err);
      alert('Failed to re-queue job. Please try again.');
    }
  }, [jobs]);

  const handleSwapCv = useCallback(async (jobId: string, cvVersionId: string) => {
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;
    const newCvId = cvVersionId || null;

    // Optimistic update
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, cv_version_id: newCvId } : j));
    setSelectedJob(prev => prev?.id === jobId ? { ...prev, cv_version_id: newCvId } : prev);

    try {
      const { error } = await supabase.from('jobs').update({ cv_version_id: newCvId }).eq('id', jobId);
      if (error) throw error;
    } catch (err) {
      // Revert
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, cv_version_id: job.cv_version_id } : j));
      setSelectedJob(prev => prev?.id === jobId ? { ...prev, cv_version_id: job.cv_version_id } : prev);
      console.error('[handleSwapCv] failed:', err);
      alert('Failed to update CV selection. Please try again.');
    }
  }, [jobs]);

  // ── Derived data ──────────────────────────────────────────────

  const filteredJobs = applyFilters(jobs, filters, activeStatus);
  const counts = buildCounts(jobs);
  const sourceMap = Object.fromEntries(sources.map(s => [s.id, s.name]));

  const activeStageTitle = activeStatus === null ? 'All Jobs' : (
    activeStatus === 'new' ? 'New Jobs' :
    activeStatus === 'matched' ? 'Matched Jobs' :
    activeStatus === 'auto_applied' ? 'Auto-Applied Jobs' :
    activeStatus === 'manual_queue' ? 'Manual Queue' :
    activeStatus === 'responded' ? 'Responded Jobs' :
    activeStatus === 'closed' ? 'Closed Jobs' : 'Jobs'
  );

  const highMatchCount = jobs.filter(j => (j.match_score ?? 0) >= 0.75).length;

  return (
    <div className={styles.layout}>
      <PipelineSidebar
        activeStatus={activeStatus}
        counts={counts}
        onSelect={setActiveStatus}
      />

      <div className={styles.main}>
        <FilterBar sources={sources} filters={filters} onChange={setFilters} />

        {/* Summary Header Bar */}
        <div className={styles.summaryBar}>
          <div className={styles.summaryTitleGroup}>
            <h1 className={styles.summaryTitle}>{activeStageTitle}</h1>
            <span className={styles.summaryCount}>
              {loading ? '…' : `${filteredJobs.length} ${filteredJobs.length === 1 ? 'job' : 'jobs'}`}
            </span>
          </div>

          <div className={styles.summaryStats}>
            {lastRunAt && (
              <div className={styles.statPill} title={`Last pipeline run: ${new Date(lastRunAt).toLocaleString('en-GB')}`}>
                <Clock size={10} style={{ color: 'var(--text-muted)' }} />
                <span className={styles.statLabel}>Last run:</span>
                <span className={styles.statVal}>{formatRelativeTime(lastRunAt)}</span>
              </div>
            )}
            <div className={styles.statPill} title="Jobs with match score >= 75%">
              <span className={styles.statDot} style={{ background: 'var(--success)' }} />
              <span className={styles.statLabel}>High match:</span>
              <span className={styles.statVal}>{highMatchCount}</span>
            </div>
            <div className={styles.statPill} title="Jobs in manual review queue">
              <span className={styles.statDot} style={{ background: 'var(--pending)' }} />
              <span className={styles.statLabel}>Manual Queue:</span>
              <span className={styles.statVal}>{counts.manual_queue ?? 0}</span>
            </div>
            <div className={styles.statPill} title="Jobs auto-applied by connector">
              <span className={styles.statDot} style={{ background: 'var(--success)' }} />
              <span className={styles.statLabel}>Auto-applied:</span>
              <span className={styles.statVal}>{counts.auto_applied ?? 0}</span>
            </div>
            <button
              id="dashboard-clear-unmatched-btn"
              className={styles.deleteUnmatchedBtn}
              onClick={handleDeleteUnmatched}
              disabled={deletingUnmatched}
              title="Delete all jobs with status='new' or match_score < 40%"
            >
              <Trash2 size={12} />
              {deletingUnmatched ? 'Deleting…' : 'Delete unmatched jobs'}
            </button>
          </div>
        </div>

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
