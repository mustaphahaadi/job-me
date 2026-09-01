import { useEffect, useRef } from 'react';
import { ExternalLink, X, RotateCcw, CheckCheck, XCircle } from 'lucide-react';
import type { Job, CvVersion, MatchBreakdown } from '@job-me/shared';
import { STATUS_DISPLAY } from '@job-me/shared';
import { PipelineTrack } from './PipelineTrack';
import { StatusTag } from './StatusTag';
import styles from './JobDetailDrawer.module.css';

interface Props {
  job: Job | null;
  cvVersions: CvVersion[];
  sourceName?: string | undefined;
  onClose: () => void;
  onMarkApplied: (jobId: string) => void;
  onDismiss: (jobId: string) => void;
  onRequeue: (jobId: string) => void;
  onSwapCv: (jobId: string, cvVersionId: string) => void;
}

function formatDateTime(dt: string | null): string {
  if (!dt) return '—';
  return new Date(dt).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatScore(score: number | null): string {
  if (score === null) return '—';
  return (score * 100).toFixed(0) + '%';
}

function BreakdownRow({ label, score, weight, detail }: {
  label: string;
  score: number;
  weight: number;
  detail?: string;
}) {
  const pct = Math.round(score * 100);
  const contribution = Math.round(score * weight * 100);
  return (
    <div className={styles.breakdownRow}>
      <span className={styles.breakdownLabel}>{label}</span>
      <div className={styles.breakdownBar}>
        <div className={styles.breakdownFill} style={{ width: `${pct}%` }} />
      </div>
      <span className={styles.breakdownVal}>{pct}% × {Math.round(weight * 100)}% = +{contribution}%</span>
      {detail && <span className={styles.breakdownDetail}>{detail}</span>}
    </div>
  );
}

function MatchBreakdownSection({ breakdown, totalScore }: { breakdown: MatchBreakdown; totalScore: number }) {
  if (breakdown.negative_keyword_hit) {
    return (
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Match breakdown</h3>
        <p className={styles.negativeNote}>
          Negative keyword hit: {breakdown.negative_keywords_found.join(', ')}. Score forced to 0.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>
        Match breakdown
        <span className={styles.totalScore}>{formatScore(totalScore)}</span>
      </h3>
      <div className={styles.breakdownList}>
        <BreakdownRow
          label="Title match"
          score={breakdown.title_match.score}
          weight={breakdown.title_match.weight}
          detail={breakdown.title_match.matched_keywords.join(', ') || 'No match'}
        />
        <BreakdownRow
          label="Skills overlap"
          score={breakdown.skills_overlap.score}
          weight={breakdown.skills_overlap.weight}
          detail={breakdown.skills_overlap.matched_skills.slice(0, 5).join(', ')}
        />
        <BreakdownRow
          label="Seniority"
          score={breakdown.seniority.score}
          weight={breakdown.seniority.weight}
          detail={breakdown.seniority.detected_level ?? 'Not detected'}
        />
        <BreakdownRow
          label="Location"
          score={breakdown.location.score}
          weight={breakdown.location.weight}
          detail={breakdown.location.accepted ? 'Accepted' : 'Outside accepted locations'}
        />
        <BreakdownRow
          label="Recency"
          score={breakdown.recency.score}
          weight={breakdown.recency.weight}
          detail={breakdown.recency.days_old >= 0 ? `${breakdown.recency.days_old} days old` : 'Date unknown'}
        />
      </div>
    </div>
  );
}

/**
 * Job detail drawer — slides in from right at 200ms ease-out (§5).
 * Contains: full description, match score breakdown, pipeline track (full),
 * CV selector, action buttons, activity log.
 */
export function JobDetailDrawer({
  job,
  cvVersions,
  sourceName,
  onClose,
  onMarkApplied,
  onDismiss,
  onRequeue,
  onSwapCv,
}: Props) {
  const drawerRef = useRef<HTMLElement>(null);

  // Focus trap and Escape key handling
  useEffect(() => {
    if (!job) return;

    // Move initial focus into the drawer (to the close button if possible, else the panel itself)
    const firstFocusable = drawerRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    (firstFocusable ?? drawerRef.current)?.focus();

    const FOCUSABLE_SELECTOR =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      // Constrain Tab to elements inside the drawer
      const panel = drawerRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [job, onClose]);

  const isOpen = job !== null;

  return (
    <>
      {/* Backdrop */}
      <div
        id="job-detail-backdrop"
        className={`${styles.backdrop} ${isOpen ? styles.backdropVisible : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <aside
        id="job-detail-drawer"
        ref={drawerRef}
        className={`${styles.drawer} ${isOpen ? styles.open : ''}`}
        aria-label="Job detail"
        aria-hidden={!isOpen}
        tabIndex={-1}
        role="dialog"
      >
        {job && (
          <>
            {/* ── Header ─────────────────────────────────────────────── */}
            <div className={styles.header}>
              <div className={styles.headerTop}>
                <div className={styles.headerMeta}>
                  <StatusTag status={job.status} />
                  {sourceName && <span className={styles.sourceName}>{sourceName}</span>}
                </div>
                <button
                  id="drawer-close-btn"
                  className={styles.closeBtn}
                  onClick={onClose}
                  aria-label="Close job detail"
                >
                  <X size={16} />
                </button>
              </div>
              <h1 className={styles.jobTitle}>{job.title}</h1>
              {job.company && <p className={styles.company}>{job.company}</p>}
              {job.url && (
                <div className={styles.linkRow}>
                  <a
                    href={job.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.sourceLink}
                    id="drawer-source-link"
                  >
                    View original posting <ExternalLink size={12} />
                  </a>
                </div>
              )}
            </div>

            {/* ── Pipeline track (full) ────────────────────────────── */}
            <div className={styles.section}>
              <PipelineTrack status={job.status} size="full" />
            </div>

            {/* ── Match breakdown ──────────────────────────────────── */}
            {job.match_breakdown ? (
              <MatchBreakdownSection breakdown={job.match_breakdown} totalScore={job.match_score ?? 0} />
            ) : (
              <div className={styles.section}>
                <p className={styles.mutedText}>Match score not yet calculated — job is queued for the next scoring pass.</p>
              </div>
            )}

            {/* ── CV version ──────────────────────────────────────── */}
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>CV version</h3>
              <select
                id="drawer-cv-select"
                className={styles.select}
                value={job.cv_version_id ?? ''}
                onChange={e => onSwapCv(job.id, e.target.value)}
                aria-label="Select CV version for this application"
              >
                <option value="">No CV selected</option>
                {cvVersions.map(cv => (
                  <option key={cv.id} value={cv.id}>
                    {cv.label}{cv.is_default_for.length > 0 ? ` (default for ${cv.is_default_for.join(', ')})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* ── Actions ─────────────────────────────────────────── */}
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Actions</h3>
              <div className={styles.actions}>
                <button
                  id="drawer-mark-applied-btn"
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  onClick={() => onMarkApplied(job.id)}
                  disabled={job.status === 'auto_applied' || job.status === 'responded' || job.status === 'closed'}
                >
                  <CheckCheck size={14} />
                  Mark as applied
                </button>
                {job.auto_apply_result === 'failed' && (
                  <button
                    id="drawer-requeue-btn"
                    className={`${styles.btn} ${styles.btnSecondary}`}
                    onClick={() => onRequeue(job.id)}
                  >
                    <RotateCcw size={14} />
                    Re-queue for auto-apply retry
                  </button>
                )}
                <button
                  id="drawer-dismiss-btn"
                  className={`${styles.btn} ${styles.btnDanger}`}
                  onClick={() => onDismiss(job.id)}
                  disabled={job.status === 'closed'}
                >
                  <XCircle size={14} />
                  Dismiss
                </button>
              </div>
            </div>

            {/* ── Auto-apply error ─────────────────────────────────── */}
            {job.auto_apply_error && (
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Auto-apply failure</h3>
                <pre className={styles.errorBlock}>{job.auto_apply_error}</pre>
              </div>
            )}

            {/* ── Activity log ─────────────────────────────────────── */}
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Activity log</h3>
              <div className={styles.activityLog}>
                <ActivityRow label="Scraped" value={formatDateTime(job.scraped_at)} />
                {job.matched_keywords.length > 0 && (
                  <ActivityRow label="Matched" value={`Keywords: ${job.matched_keywords.join(', ')}`} />
                )}
                {job.auto_apply_attempted_at && (
                  <ActivityRow
                    label="Auto-apply attempted"
                    value={`${formatDateTime(job.auto_apply_attempted_at)} — ${STATUS_DISPLAY[job.status]}`}
                  />
                )}
              </div>
            </div>

            {/* ── Full description ─────────────────────────────────── */}
            {job.description && (
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Job description</h3>
                <div className={styles.description}>
                  {job.description}
                </div>
              </div>
            )}
          </>
        )}
      </aside>
    </>
  );
}

function ActivityRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.activityRow}>
      <span className={styles.activityLabel}>{label}</span>
      <span className={styles.activityValue}>{value}</span>
    </div>
  );
}
