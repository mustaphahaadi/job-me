import { useEffect, useRef, useState } from 'react';
import { ExternalLink, X, RotateCcw, CheckCheck, XCircle, Copy, Check, MapPin, Trash2 } from 'lucide-react';
import type { Job, CvVersion, MatchBreakdown } from '@job-me/shared';
import { STATUS_DISPLAY } from '@job-me/shared';
import { PipelineTrack } from './PipelineTrack';
import { StatusTag } from './StatusTag';
import styles from './JobDetailDrawer.module.css';

interface Props {
  job: Job | null;
  cvVersions: CvVersion[];
  sourceName?: string | undefined;
  autoApplyThreshold?: number | undefined;
  onClose: () => void;
  onMarkApplied: (jobId: string) => void;
  onMarkResponded: (jobId: string) => void;
  onDismiss: (jobId: string) => void;
  onRequeue: (jobId: string) => void;
  onSwapCv: (jobId: string, cvVersionId: string) => void;
  onDelete?: (jobId: string) => void;
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
  label: string; score: number; weight: number; detail?: string;
}) {
  const pct = Math.round(score * 100);
  const contribution = Math.round(score * weight * 100);
  const fillColor = pct >= 75 ? 'var(--success)' : pct >= 50 ? 'var(--accent)' : 'var(--pending)';
  return (
    <div className={styles.breakdownRow}>
      <span className={styles.breakdownLabel}>{label}</span>
      <div className={styles.breakdownBar}>
        <div className={styles.breakdownFill} style={{ width: `${pct}%`, background: fillColor }} />
      </div>
      <span className={styles.breakdownVal}>
        {pct}% <span className={styles.breakdownContrib}>+{contribution}%</span>
      </span>
      {detail && <span className={styles.breakdownDetail}>{detail}</span>}
    </div>
  );
}

function MatchBreakdownSection({ breakdown, totalScore, threshold }: {
  breakdown: MatchBreakdown; totalScore: number; threshold: number;
}) {
  if (breakdown.negative_keyword_hit) {
    return (
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Match breakdown</h3>
        <p className={styles.negativeNote}>
          ✕ Negative keyword: <strong>{breakdown.negative_keywords_found.join(', ')}</strong> — score forced to 0.
        </p>
      </div>
    );
  }

  const scoreColor = totalScore >= threshold ? 'var(--success)' : totalScore >= 0.50 ? 'var(--accent)' : 'var(--pending)';

  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>
        Match breakdown
        <span className={styles.totalScore} style={{ color: scoreColor }}>{formatScore(totalScore)}</span>
      </h3>
      <div className={styles.breakdownList}>
        <BreakdownRow label="Title"    score={breakdown.title_match.score}   weight={breakdown.title_match.weight}   detail={breakdown.title_match.matched_keywords.join(', ') || 'No match'} />
        <BreakdownRow label="Skills"   score={breakdown.skills_overlap.score} weight={breakdown.skills_overlap.weight} detail={breakdown.skills_overlap.matched_skills.slice(0, 5).join(', ')} />
        <BreakdownRow label="Seniority" score={breakdown.seniority.score}    weight={breakdown.seniority.weight}     detail={breakdown.seniority.detected_level ?? 'Not detected'} />
        <BreakdownRow label="Location" score={breakdown.location.score}      weight={breakdown.location.weight}      detail={breakdown.location.accepted ? 'Accepted' : 'Outside accepted'} />
        <BreakdownRow label="Recency"  score={breakdown.recency.score}       weight={breakdown.recency.weight}       detail={breakdown.recency.days_old >= 0 ? `${breakdown.recency.days_old}d old` : 'Date unknown'} />
      </div>
      <p className={styles.thresholdNote}>
        Auto-apply threshold: {Math.round(threshold * 100)}% —{' '}
        {totalScore >= threshold
          ? 'eligible for auto-apply.'
          : 'below threshold, manual review required.'}
      </p>
    </div>
  );
}

function CoverLetterSection({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>
        AI cover letter
        <button className={styles.copyBtn} onClick={handleCopy} title="Copy to clipboard">
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </h3>
      <div className={styles.coverLetter}>{text}</div>
    </div>
  );
}

export function JobDetailDrawer({
  job, cvVersions, sourceName, autoApplyThreshold = 0.75, onClose,
  onMarkApplied, onMarkResponded, onDismiss, onRequeue, onSwapCv, onDelete,
}: Props) {
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!job) return;
    const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab') return;
      const panel = drawerRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }

    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [job, onClose]);

  const isOpen = job !== null;

  return (
    <>
      <div
        id="job-detail-backdrop"
        className={`${styles.backdrop} ${isOpen ? styles.backdropVisible : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
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
            {/* ── Header ──────────────────────────────────────────*/}
            <div className={styles.header}>
              <div className={styles.headerTop}>
                <div className={styles.headerMeta}>
                  <StatusTag status={job.status} />
                  {sourceName && <span className={styles.sourceName}>{sourceName}</span>}
                </div>
                <button id="drawer-close-btn" className={styles.closeBtn} onClick={onClose} aria-label="Close">
                  <X size={14} />
                </button>
              </div>
              <h1 className={styles.jobTitle}>{job.title}</h1>
              {job.company && <p className={styles.company}>{job.company}</p>}
              <div className={styles.headerFooter}>
                {job.raw_location && (
                  <span className={styles.location}>
                    <MapPin size={11} />
                    {job.raw_location}
                  </span>
                )}
                {job.url && (
                  <a href={job.url} target="_blank" rel="noopener noreferrer" className={styles.sourceLink} id="drawer-source-link">
                    View posting <ExternalLink size={11} />
                  </a>
                )}
              </div>
            </div>

            {/* ── Pipeline track ───────────────────────────────────*/}
            <div className={styles.section}>
              <PipelineTrack status={job.status} size="full" />
            </div>

            {/* ── Actions ─────────────────────────────────────────*/}
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Actions</h3>
              <div className={styles.actions}>
                <button
                  id="drawer-mark-applied-btn"
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  onClick={() => onMarkApplied(job.id)}
                  disabled={['auto_applied', 'manual_applied', 'responded', 'closed'].includes(job.status)}
                >
                  <CheckCheck size={13} /> Mark applied
                </button>
                {(job.status === 'auto_applied' || job.status === 'manual_applied') && (
                  <button
                    id="drawer-mark-responded-btn"
                    className={`${styles.btn} ${styles.btnSecondary}`}
                    onClick={() => onMarkResponded(job.id)}
                  >
                    <CheckCheck size={13} /> Mark responded
                  </button>
                )}
                {job.auto_apply_result === 'failed' && (
                  <button id="drawer-requeue-btn" className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => onRequeue(job.id)}>
                    <RotateCcw size={13} /> Re-queue
                  </button>
                )}
                <button
                  id="drawer-dismiss-btn"
                  className={`${styles.btn} ${styles.btnDanger}`}
                  onClick={() => onDismiss(job.id)}
                  disabled={job.status === 'closed'}
                >
                  <XCircle size={13} /> Dismiss
                </button>
                {onDelete && (
                  <button
                    id="drawer-delete-btn"
                    className={`${styles.btn} ${styles.btnDanger}`}
                    onClick={() => { onDelete(job.id); onClose(); }}
                  >
                    <Trash2 size={13} /> Delete
                  </button>
                )}
              </div>
            </div>

            {/* ── Match breakdown ──────────────────────────────────*/}
            {job.match_breakdown ? (
              <MatchBreakdownSection breakdown={job.match_breakdown} totalScore={job.match_score ?? 0} threshold={autoApplyThreshold} />
            ) : (
              <div className={styles.section}>
                <p className={styles.mutedText}>Match score pending — queued for next scoring pass.</p>
              </div>
            )}

            {/* ── CV version ───────────────────────────────────────*/}
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>CV version</h3>
              <select
                id="drawer-cv-select"
                className={styles.select}
                value={job.cv_version_id ?? ''}
                onChange={e => onSwapCv(job.id, e.target.value)}
                aria-label="Select CV version"
              >
                <option value="">No CV selected</option>
                {cvVersions.map(cv => (
                  <option key={cv.id} value={cv.id}>
                    {cv.label}{cv.is_default_for.length > 0 ? ` · default for ${cv.is_default_for.join(', ')}` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* ── AI cover letter ──────────────────────────────────*/}
            {job.cover_letter_text && <CoverLetterSection text={job.cover_letter_text} />}

            {/* ── Auto-apply error ─────────────────────────────────*/}
            {job.auto_apply_error && (
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Auto-apply failure</h3>
                <pre className={styles.errorBlock}>{job.auto_apply_error}</pre>
              </div>
            )}

            {/* ── Activity log ─────────────────────────────────────*/}
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Activity</h3>
              <div className={styles.activityLog}>
                <ActivityRow label="Scraped" value={formatDateTime(job.scraped_at)} />
                {job.matched_keywords.length > 0 && (
                  <ActivityRow label="Keywords" value={job.matched_keywords.join(', ')} />
                )}
                {job.auto_apply_attempted_at && (
                  <ActivityRow label="Auto-applied" value={`${formatDateTime(job.auto_apply_attempted_at)} — ${STATUS_DISPLAY[job.status]}`} />
                )}
              </div>
            </div>

            {/* ── Description ──────────────────────────────────────*/}
            {job.description && (
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Description</h3>
                <div className={styles.description}>{job.description}</div>
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
