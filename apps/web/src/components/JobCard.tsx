import type { Job } from '@job-me/shared';
import { MapPin } from 'lucide-react';
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

function getScoreColor(score: number | null): string {
  if (score === null) return 'var(--text-muted)';
  if (score >= 0.75) return 'var(--success)';
  if (score >= 0.5) return 'var(--accent)';
  return 'var(--pending)';
}

/**
 * Job card — §4 layout:
 *   pipeline track (top)
 *   title + company
 *   location + matched keywords tags
 *   source + posted date + match score (data font, muted)
 *   status tag (top-right)
 *
 * Hover: border shifts to --accent, bg to --surface-raised. No scale/transform.
 */
export function JobCard({ job, sourceName, isSelected, onClick }: Props) {
  const scoreColor = getScoreColor(job.match_score);
  const keywords = job.matched_keywords ? job.matched_keywords.slice(0, 4) : [];

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

        {/* Location & Matched Keywords Tags */}
        {(job.raw_location || keywords.length > 0) && (
          <div className={styles.tagGroup}>
            {job.raw_location && (
              <span className={styles.locationBadge} title={`Location: ${job.raw_location}`}>
                <MapPin size={10} />
                <span>{job.raw_location}</span>
              </span>
            )}
            {keywords.map(kw => (
              <span key={kw} className={styles.keywordTag}>
                {kw}
              </span>
            ))}
          </div>
        )}

        <div className={styles.meta}>
          {sourceName && (
            <span className={styles.metaItem}>{sourceName}</span>
          )}
          <span className={styles.metaItem}>Posted {formatDate(job.posted_date)}</span>
          {job.match_score !== null && (
            <span className={styles.metaItem}>
              Match&nbsp;
              <span className={styles.scoreVal} style={{ color: scoreColor }}>
                {formatScore(job.match_score)}
              </span>
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

