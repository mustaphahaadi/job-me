import type { JobStatus } from '@job-me/shared';
import { PIPELINE_TRACK, pipelineIndex, STATUS_COLOR_VAR } from '@job-me/shared';
import styles from './PipelineTrack.module.css';

interface Props {
  status: JobStatus;
  size?: 'compact' | 'full';
}

const TRACK_LABELS: Record<string, string> = {
  new: 'New',
  matched: 'Matched',
  auto_applied: 'Applied',
  responded: 'Responded',
  closed: 'Closed',
};

/**
 * Horizontal pipeline tracker — the signature element (§4).
 * Five dots connected by a line. Filled = passed stage. Current = pulsing.
 * size="compact" — used on job cards (no labels shown below dots)
 * size="full"    — used in the detail drawer (labels shown)
 */
export function PipelineTrack({ status, size = 'compact' }: Props) {
  const currentIdx = pipelineIndex(status);

  return (
    <div
      className={`${styles.track} ${size === 'full' ? styles.full : styles.compact}`}
      role="list"
      aria-label="Pipeline stage"
    >
      {PIPELINE_TRACK.map((stage, idx) => {
        const isPast    = idx < currentIdx;
        const isCurrent = idx === currentIdx;
        const color     = isPast || isCurrent ? STATUS_COLOR_VAR[stage] : 'transparent';
        const borderColor = isPast || isCurrent ? STATUS_COLOR_VAR[stage] : 'var(--border)';

        return (
          <div key={stage} className={styles.stageWrapper} role="listitem">
            {idx > 0 && (
              <div
                className={styles.connector}
                style={{ background: isPast ? STATUS_COLOR_VAR[PIPELINE_TRACK[idx - 1]!] : 'var(--border)' }}
              />
            )}
            <div className={styles.dotWrapper}>
              <div
                className={`${styles.dot} ${isCurrent ? styles.pulse : ''}`}
                style={{
                  background: color,
                  borderColor,
                }}
                aria-label={`${TRACK_LABELS[stage]}${isCurrent ? ' (current)' : isPast ? ' (completed)' : ''}`}
              />
              {size === 'full' && (
                <span
                  className={styles.label}
                  style={{ color: isCurrent ? STATUS_COLOR_VAR[stage] : isPast ? 'var(--text-muted)' : 'var(--border)' }}
                >
                  {stage === 'auto_applied' && (status === 'manual_queue')
                    ? 'Queue'
                    : TRACK_LABELS[stage]}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
