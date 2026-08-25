import type { Job } from '@job-me/shared';
import { PipelineTrack } from './PipelineTrack';
import { StatusTag } from './StatusTag';
import styles from './JobCard.module.css';

interface Props {
  job: Job;
  sourceName?: string | undefined;
  isSelected?: boolean;
  onClick: (job: Job) => void;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatScore(score: number | null): string {
  if (score === null) return '—';
  return (score * 100).toFixed(0) + '%';
}

/**
 * Job card — §4 layout:
 *   pipeline track (top)
 *   title + company
 *   source + posted date + match score (data font, muted)
 *   status tag (absolute, top-right)
 *
 * Hover: border shifts to --accent, bg to --surface-raised. No scale/transform.
 */
export function JobCard({ job, sourceName, isSelected, onClick }: Props) {
  return (
    <article
      id={`job-card-${job.id}`}
      className={`${styles.card} ${isSelected ? styles.selected : ''}`}
      onClick={() => onClick(job)}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClick(job); }}
      aria-label={`${job.title} at ${job.company ?? 'Unknown company'}`}
      aria-pressed={isSelected}
    >
      <div className={styles.trackRow}>
        <PipelineTrack status={job.status} size="compact" />
      </div>

      <div className={styles.body}>
        <div className={styles.titleRow}>
          <div className={styles.titleGroup}>
            <h2 className={styles.title}>{job.title}</h2>
            {job.company && (
              <span className={styles.company}>{job.company}</span>
            )}
          </div>
          <div className={styles.tagSlot}>
            <StatusTag status={job.status} />
          </div>
        </div>

        <div className={styles.meta}>
          {sourceName && (
            <span className={styles.metaItem}>{sourceName}</span>
          )}
          <span className={styles.metaItem}>Posted {formatDate(job.posted_date)}</span>
          {job.match_score !== null && (
            <span className={styles.metaItem}>
              Match&nbsp;
              <span style={{ color: 'var(--text)' }}>{formatScore(job.match_score)}</span>
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
