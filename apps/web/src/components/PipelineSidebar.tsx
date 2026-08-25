import type { JobStatus } from '@job-me/shared';
import { JOB_STATUSES, STATUS_COLOR_VAR, STATUS_DISPLAY } from '@job-me/shared';
import styles from './PipelineSidebar.module.css';

interface Props {
  activeStatus: JobStatus | null;
  counts: Partial<Record<JobStatus, number>>;
  onSelect: (status: JobStatus | null) => void;
}

/**
 * Left rail — vertical pipeline stage stepper with live counts.
 * Click a stage to filter the job list. "All" option clears filter.
 * Below 900px: collapses to horizontal tabs via CSS media query.
 */
export function PipelineSidebar({ activeStatus, counts, onSelect }: Props) {
  return (
    <nav className={styles.sidebar} aria-label="Pipeline filter">
      <div className={styles.logo}>job-me</div>

      <ul className={styles.stageList} role="list">
        {/* All jobs shortcut */}
        <li>
          <button
            id="sidebar-all"
            className={`${styles.stageBtn} ${activeStatus === null ? styles.active : ''}`}
            onClick={() => onSelect(null)}
            aria-current={activeStatus === null ? 'page' : undefined}
          >
            <span className={styles.stageDot} style={{ background: 'var(--text-muted)' }} />
            <span className={styles.stageName}>All jobs</span>
            <span className={styles.stageCount}>
              {Object.values(counts).reduce((a, b) => (a ?? 0) + (b ?? 0), 0)}
            </span>
          </button>
        </li>

        <li aria-hidden="true"><hr className={styles.divider} /></li>

        {JOB_STATUSES.map(status => {
          const isActive = activeStatus === status;
          const count = counts[status] ?? 0;
          return (
            <li key={status}>
              <button
                id={`sidebar-${status}`}
                className={`${styles.stageBtn} ${isActive ? styles.active : ''}`}
                onClick={() => onSelect(status)}
                aria-current={isActive ? 'page' : undefined}
              >
                <span
                  className={styles.stageDot}
                  style={{ background: STATUS_COLOR_VAR[status] }}
                />
                <span className={styles.stageName}>{STATUS_DISPLAY[status]}</span>
                <span className={`${styles.stageCount} ${count > 0 && (status === 'manual_queue') ? styles.countPending : ''}`}>
                  {count}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
