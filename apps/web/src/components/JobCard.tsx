import { Fragment } from 'react';
import type { Job } from '@job-me/shared';
import { MapPin, Clock } from 'lucide-react';
import { PipelineTrack } from './PipelineTrack';
import { StatusTag } from './StatusTag';
import styles from './JobCard.module.css';

interface Props {
  job: Job;
  sourceName?: string | undefined;
  isSelected?: boolean;
  onClick: (job: Job) => void;
}

function daysOld(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const timestamp = new Date(dateStr).getTime();
  if (!Number.isFinite(timestamp)) return null;
  // Clamp future dates (source-data errors) so they do not render as "-3d ago".
  return Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
}

function ageBadge(dateStr: string | null): { label: string; color: string } | null {
  const days = daysOld(dateStr);
  if (days === null) return null;
  if (days === 0) return { label: 'Today', color: 'var(--success)' };
  if (days === 1) return { label: '1d ago', color: 'var(--success)' };
  if (days <= 7) return { label: `${days}d ago`, color: 'var(--accent)' };
  if (days <= 21) return { label: `${days}d ago`, color: 'var(--pending)' };
  return { label: `${days}d ago`, color: 'var(--danger)' };
}

function getScoreColor(score: number | null): string {
  if (score === null) return 'var(--text-faint)';
  if (score >= 0.75) return 'var(--success)';
  if (score >= 0.5) return 'var(--accent)';
  return 'var(--pending)';
}

export function JobCard({ job, sourceName, isSelected, onClick }: Props) {
  const keywords = job.matched_keywords ? job.matched_keywords.slice(0, 4) : [];
  const rawScore = job.match_score;
  const scorePct = typeof rawScore === 'number' && Number.isFinite(rawScore)
    ? Math.round(rawScore * 100)
    : null;
  const scoreColor = getScoreColor(scorePct === null ? null : scorePct / 100);

  const metaItems: Array<{ key: string; node: React.ReactNode }> = [];
  if (sourceName) metaItems.push({ key: 'source', node: `Source: ${sourceName}` });
  const badge = ageBadge(job.posted_date);
  if (badge) metaItems.push({
    key: 'age',
    node: (
      <>
        <Clock size={9} style={{ color: badge.color }} />
        <span style={{ color: badge.color }}>{badge.label}</span>
      </>
    ),
  });
  if (scorePct !== null) metaItems.push({
    key: 'score',
    node: (
      <>
        Match&nbsp;
        <span className={styles.scoreVal} style={{ color: scoreColor }}>
          {scorePct}%
        </span>
      </>
    ),
  });

  return (
    <article
      id={`job-card-${job.id}`}
      className={`${styles.card} ${isSelected ? styles.selected : ''}`}
      onClick={() => onClick(job)}
      role="button"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(job);
        }
      }}
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
            {job.company && <span className={styles.company}>{job.company}</span>}
          </div>
          <div className={styles.tagSlot}>
            {scorePct !== null ? (
              <span
                className={styles.scoreBadge}
                style={{
                  color: scoreColor,
                  borderColor: scoreColor,
                  background: `color-mix(in srgb, ${scoreColor} 12%, transparent)`,
                }}
              >
                {scorePct}% Match
              </span>
            ) : (
              <span className={styles.scoreBadgeUnscored}>
                Unscored
              </span>
            )}
            <StatusTag status={job.status} />
          </div>
        </div>

        {(job.raw_location || keywords.length > 0) && (
          <div className={styles.tagGroup}>
            {job.raw_location && (
              <span className={styles.locationBadge}>
                <MapPin size={9} />
                <span>{job.raw_location}</span>
              </span>
            )}
            {keywords.map(kw => (
              <span key={kw} className={styles.keywordTag}>{kw}</span>
            ))}
          </div>
        )}

        {scorePct !== null && (
          <div className={styles.scoreBar}>
            <div
              className={styles.scoreBarFill}
              style={{ width: `${scorePct}%`, background: scoreColor }}
            />
          </div>
        )}

        <div className={styles.meta}>
          {metaItems.map((item, i) => (
            <Fragment key={item.key}>
              {i > 0 && <span className={styles.metaDot} />}
              <span className={styles.metaItem}>{item.node}</span>
            </Fragment>
          ))}
        </div>
      </div>
    </article>
  );
}
