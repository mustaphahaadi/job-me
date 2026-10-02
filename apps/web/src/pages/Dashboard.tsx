import { useState, useEffect, useCallback } from 'react';
import { Trash2, Clock, CheckSquare, Square, X } from 'lucide-react';
import type { Job, JobStatus, Source, CvVersion, Settings } from '@job-me/shared';
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

  if (activeStatus !== null) out = out.filter(j => j.status === activeStatus);

  if (filters.sourceIds.length > 0)
    out = out.filter(j => j.source_id && filters.sourceIds.includes(j.source_id));

  if (filters.roleKeyword.trim()) {
    const kw = filters.roleKeyword.toLowerCase();
    out = out.filter(j =>
      j.title.toLowerCase().includes(kw) ||
      (j.company ?? '').toLowerCase().includes(kw)
    );
  }

  if (filters.maxDaysOld < 90) {
    const cutoff = Date.now() - filters.maxDaysOld * 86400_000;
    out = out.filter(j => !j.posted_date || new Date(j.posted_date).getTime() >= cutoff);
  }

  if (filters.minMatchScore > 0)
    out = out.filter(j => (j.match_score ?? 0) >= filters.minMatchScore);

  out.sort((a, b) => {
    switch (filters.sortBy) {
      case 'posted_date':  return (b.posted_date ?? '').localeCompare(a.posted_date ?? '');
      case 'match_score':  return (b.match_score ?? 0) - (a.match_score ?? 0);
      case 'days_old': {
        const aAge = a.posted_date ? Date.now() - new Date(a.posted_date).getTime() : -1;
        const bAge = b.posted_date ? Date.now() - new Date(b.posted_date).getTime() : -1;
        return aAge - bAge;
      }
      default: return (b.scraped_at ?? '').localeCompare(a.scraped_at ?? '');
    }
  });

  return out;
}

function buildCounts(jobs: Job[]): Partial<Record<JobStatus, number>> {
  const counts: Partial<Record<JobStatus, number>> = {};
  for (const job of jobs) counts[job.status] = (counts[job.status] ?? 0) + 1;
  return counts;
}

async function deleteJobIds(ids: string[]): Promise<void> {
  // Delete in chunks of 100 to stay within Supabase URL length limits
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { error } = await supabase.from('jobs').delete().in('id', chunk);
    if (error) throw error;
  }
}

export default function Dashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [cvVersions, setCvVersions] = useState<CvVersion[]>([]);
  const [activeStatus, setActiveStatus] = useState<JobStatus | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);

  // ── Selection state ───────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const PAGE_SIZE = 200;

  // ── Initial load ──────────────────────────────────────────────
  useEffect(() => {
    void (async () => {
      setLoading(true);
      const [jobsRes, sourcesRes, cvRes, settingsRes] = await Promise.all([
        supabase.from('jobs').select('*').order('scraped_at', { ascending: false }).range(0, PAGE_SIZE - 1),
        supabase.from('sources').select('*').order('name'),
        supabase.from('cv_versions').select('*').order('uploaded_at', { ascending: false }),
        supabase.from('settings').select('days_posted_default').eq('id', 1).single(),
      ]);
      if (jobsRes.data) {
        setJobs(jobsRes.data as Job[]);
        setHasMore(jobsRes.data.length === PAGE_SIZE);
      }
      if (sourcesRes.data) {
        setSources(sourcesRes.data as Source[]);
        const times = (sourcesRes.data as Source[]).map(s => s.last_scraped_at).filter(Boolean) as string[];
        if (times.length > 0) setLastRunAt(times.sort().reverse()[0] ?? null);
      }
      if (cvRes.data) setCvVersions(cvRes.data as CvVersion[]);
      if (settingsRes.data) {
        const days = (settingsRes.data as Pick<Settings, 'days_posted_default'>).days_posted_default;
        setFilters(f => ({ ...f, maxDaysOld: days }));
      }
      setLoading(false);
    })();
  }, []);

  const handleLoadMore = useCallback(async () => {
    setLoadingMore(true);
    const nextPage = page + 1;
    const from = nextPage * PAGE_SIZE;
    const { data } = await supabase
      .from('jobs').select('*')
      .order('scraped_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (data) {
      setJobs(prev => [...prev, ...data as Job[]]);
      setHasMore(data.length === PAGE_SIZE);
      setPage(nextPage);
    }
    setLoadingMore(false);
  }, [page]);

  // ── Realtime ──────────────────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel('jobs-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, payload => {
        setJobs(prev => {
          if (payload.eventType === 'INSERT') return [payload.new as Job, ...prev];
          if (payload.eventType === 'UPDATE') {
            const updated = payload.new as Job;
            return prev.map(j => j.id === updated.id ? updated : j);
          }
          if (payload.eventType === 'DELETE')
            return prev.filter(j => j.id !== (payload.old as Job).id);
          return prev;
        });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, []);

  // ── Delete helpers ────────────────────────────────────────────

  function removeFromState(ids: string[]) {
    const set = new Set(ids);
    setJobs(prev => prev.filter(j => !set.has(j.id)));
    if (selectedJob && set.has(selectedJob.id)) setSelectedJob(null);
    setSelectedIds(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n; });
  }

  /** Delete a single job (called from drawer). */
  const handleDeleteJob = useCallback(async (jobId: string) => {
    if (!confirm('Delete this job? This cannot be undone.')) return;
    removeFromState([jobId]);
    try {
      await deleteJobIds([jobId]);
    } catch (err) {
      console.error('[handleDeleteJob]', err);
      alert('Failed to delete job.');
      const { data } = await supabase.from('jobs').select('*').order('scraped_at', { ascending: false });
      if (data) setJobs(data as Job[]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJob]);

  /** Bulk delete selected jobs. */
  const handleBulkDelete = useCallback(async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} selected job${ids.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
    setBulkDeleting(true);
    removeFromState(ids);
    try {
      await deleteJobIds(ids);
    } catch (err) {
      console.error('[handleBulkDelete]', err);
      alert('Some jobs failed to delete.');
      const { data } = await supabase.from('jobs').select('*').order('scraped_at', { ascending: false });
      if (data) setJobs(data as Job[]);
    } finally {
      setBulkDeleting(false);
      setSelectMode(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds]);

  /** Delete all closed/unmatched jobs (score < 40% or status=new). */
  const handleDeleteUnmatched = useCallback(async () => {
    const ids = jobs
      .filter(j => j.status === 'new' || j.status === 'closed' || (j.match_score ?? 0) < 0.40)
      .map(j => j.id);
    if (ids.length === 0) { alert('No low-score or closed jobs to delete.'); return; }
    if (!confirm(`Delete ${ids.length} low-score / closed job${ids.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
    removeFromState(ids);
    try {
      await deleteJobIds(ids);
    } catch (err) {
      console.error('[handleDeleteUnmatched]', err);
      alert('Failed to delete jobs.');
      const { data } = await supabase.from('jobs').select('*').order('scraped_at', { ascending: false });
      if (data) setJobs(data as Job[]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);

  // ── Selection helpers ─────────────────────────────────────────

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function toggleSelectAll(visibleIds: string[]) {
    const allSelected = visibleIds.every(id => selectedIds.has(id));
    setSelectedIds(allSelected ? new Set() : new Set(visibleIds));
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  // ── Job actions ───────────────────────────────────────────────

  function selectCv(jobTitle: string): CvVersion | null {
    return selectCvForTitle(cvVersions, jobTitle);
  }

  const handleMarkApplied = useCallback(async (jobId: string) => {
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;
    const cv = job.cv_version_id
      ? (cvVersions.find(c => c.id === job.cv_version_id) ?? null)
      : selectCv(job.title);
    const nextStatus: JobStatus = 'manual_queue';
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: nextStatus } : j));
    setSelectedJob(prev => prev?.id === jobId ? { ...prev, status: nextStatus } : prev);
    try {
      await supabase.from('applications').insert({ job_id: jobId, method: 'manual', cv_version_id: cv?.id ?? null });
      const { error } = await supabase.from('jobs').update({ status: nextStatus, cv_version_id: cv?.id ?? null }).eq('id', jobId);
      if (error) throw error;
    } catch (err) {
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: job.status } : j));
      setSelectedJob(prev => prev?.id === jobId ? { ...prev, status: job.status } : prev);
      console.error('[handleMarkApplied]', err);
      alert('Failed to mark as applied.');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, cvVersions]);

  const handleDismiss = useCallback(async (jobId: string) => {
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'closed' } : j));
    setSelectedJob(prev => prev?.id === jobId ? { ...prev, status: 'closed' } : prev);
    try {
      const { error } = await supabase.from('jobs').update({ status: 'closed' }).eq('id', jobId);
      if (error) throw error;
    } catch (err) {
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: job.status } : j));
      setSelectedJob(prev => prev?.id === jobId ? { ...prev, status: job.status } : prev);
      console.error('[handleDismiss]', err);
      alert('Failed to dismiss job.');
    }
  }, [jobs]);

  const handleRequeue = useCallback(async (jobId: string) => {
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'matched', auto_apply_result: null } : j));
    setSelectedJob(prev => prev?.id === jobId ? { ...prev, status: 'matched', auto_apply_result: null } : prev);
    try {
      const { error } = await supabase.from('jobs').update({ status: 'matched', auto_apply_result: null, auto_apply_error: null }).eq('id', jobId);
      if (error) throw error;
    } catch (err) {
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: job.status, auto_apply_result: job.auto_apply_result } : j));
      setSelectedJob(prev => prev?.id === jobId ? { ...prev, status: job.status, auto_apply_result: job.auto_apply_result } : prev);
      console.error('[handleRequeue]', err);
      alert('Failed to re-queue job.');
    }
  }, [jobs]);

  const handleSwapCv = useCallback(async (jobId: string, cvVersionId: string) => {
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;
    const newCvId = cvVersionId || null;
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, cv_version_id: newCvId } : j));
    setSelectedJob(prev => prev?.id === jobId ? { ...prev, cv_version_id: newCvId } : prev);
    try {
      const { error } = await supabase.from('jobs').update({ cv_version_id: newCvId }).eq('id', jobId);
      if (error) throw error;
    } catch (err) {
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, cv_version_id: job.cv_version_id } : j));
      setSelectedJob(prev => prev?.id === jobId ? { ...prev, cv_version_id: job.cv_version_id } : prev);
      console.error('[handleSwapCv]', err);
      alert('Failed to update CV selection.');
    }
  }, [jobs]);

  // ── Derived ───────────────────────────────────────────────────

  const filteredJobs = applyFilters(jobs, filters, activeStatus);
  const counts = buildCounts(jobs);
  const sourceMap = Object.fromEntries(sources.map(s => [s.id, s.name]));
  const highMatchCount = jobs.filter(j => (j.match_score ?? 0) >= 0.75).length;

  const activeStageTitle =
    activeStatus === null         ? 'All Jobs'        :
    activeStatus === 'new'        ? 'New'             :
    activeStatus === 'matched'    ? 'Matched'         :
    activeStatus === 'auto_applied' ? 'Auto-Applied'  :
    activeStatus === 'manual_queue' ? 'Manual Queue'  :
    activeStatus === 'responded'  ? 'Responded'       :
    activeStatus === 'closed'     ? 'Closed'          : 'Jobs';

  const visibleIds = filteredJobs.map(j => j.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id));

  return (
    <div className={styles.layout}>
      <PipelineSidebar activeStatus={activeStatus} counts={counts} onSelect={setActiveStatus} />

      <div className={styles.main}>
        <FilterBar sources={sources} filters={filters} onChange={setFilters} />

        {/* ── Summary bar ──────────────────────────────────────── */}
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
            <div className={styles.statPill}>
              <span className={styles.statDot} style={{ background: 'var(--success)' }} />
              <span className={styles.statLabel}>High match:</span>
              <span className={styles.statVal}>{highMatchCount}</span>
            </div>
            <div className={styles.statPill}>
              <span className={styles.statDot} style={{ background: 'var(--pending)' }} />
              <span className={styles.statLabel}>Queue:</span>
              <span className={styles.statVal}>{counts.manual_queue ?? 0}</span>
            </div>

            {/* Select mode toggle */}
            <button
              className={`${styles.selectModeBtn} ${selectMode ? styles.selectModeBtnActive : ''}`}
              onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
              title="Select jobs to bulk delete"
            >
              <CheckSquare size={12} />
              {selectMode ? 'Cancel' : 'Select'}
            </button>

            {/* Delete low-score / closed */}
            <button
              className={styles.deleteUnmatchedBtn}
              onClick={handleDeleteUnmatched}
              title="Delete all jobs with score < 40% or status = closed/new"
            >
              <Trash2 size={12} />
              Clean up
            </button>
          </div>
        </div>

        {/* ── Bulk action toolbar ───────────────────────────────── */}
        {selectMode && (
          <div className={styles.bulkBar}>
            <button
              className={styles.bulkSelectAll}
              onClick={() => toggleSelectAll(visibleIds)}
            >
              {allVisibleSelected
                ? <CheckSquare size={13} style={{ color: 'var(--accent)' }} />
                : <Square size={13} />}
              {allVisibleSelected ? 'Deselect all' : `Select all ${filteredJobs.length}`}
            </button>

            {selectedIds.size > 0 && (
              <>
                <span className={styles.bulkCount}>{selectedIds.size} selected</span>
                <button
                  className={styles.bulkDeleteBtn}
                  onClick={handleBulkDelete}
                  disabled={bulkDeleting}
                >
                  <Trash2 size={12} />
                  {bulkDeleting ? 'Deleting…' : `Delete ${selectedIds.size}`}
                </button>
              </>
            )}

            <button className={styles.bulkCancelBtn} onClick={exitSelectMode}>
              <X size={12} /> Cancel
            </button>
          </div>
        )}

        {/* ── Job list ─────────────────────────────────────────── */}
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
            <>
              {filteredJobs.map(job => (
                <div key={job.id} className={styles.cardRow}>
                  {selectMode && (
                    <button
                      className={styles.checkboxBtn}
                      onClick={() => toggleSelect(job.id)}
                      aria-label={selectedIds.has(job.id) ? 'Deselect' : 'Select'}
                    >
                      {selectedIds.has(job.id)
                        ? <CheckSquare size={15} style={{ color: 'var(--accent)' }} />
                        : <Square size={15} style={{ color: 'var(--text-faint)' }} />}
                    </button>
                  )}
                  <div className={styles.cardWrap} style={{ flex: 1 }}>
                    <JobCard
                      job={job}
                      sourceName={job.source_id ? sourceMap[job.source_id] : undefined}
                      isSelected={selectedJob?.id === job.id}
                      onClick={selectMode ? () => toggleSelect(job.id) : setSelectedJob}
                    />
                  </div>
                </div>
              ))}
              {hasMore && (
                <button className={styles.loadMoreBtn} onClick={handleLoadMore} disabled={loadingMore}>
                  {loadingMore ? 'Loading…' : 'Load more jobs'}
                </button>
              )}
            </>
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
        onDelete={handleDeleteJob}
      />
    </div>
  );
}
