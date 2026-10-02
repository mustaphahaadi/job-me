import { useState, useEffect } from 'react';
import { ExternalLink } from 'lucide-react';
import type { Application, Job, CvVersion } from '@job-me/shared';
import { supabase } from '../lib/supabase';
import styles from './Applications.module.css';

interface ApplicationRow extends Application {
  job: Pick<Job, 'title' | 'company' | 'url' | 'match_score'> | null;
  cv: Pick<CvVersion, 'label'> | null;
}

function formatDateTime(dt: string): string {
  return new Date(dt).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function Applications() {
  const [rows, setRows] = useState<ApplicationRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setLoading(true);

      // Fetch applications with joined job and cv data
      const { data: apps } = await supabase
        .from('applications')
        .select('*, job:job_id(title, company, url, match_score), cv:cv_version_id(label)')
        .order('applied_at', { ascending: false })
        .limit(500);

      setRows((apps ?? []) as ApplicationRow[]);
      setLoading(false);
    })();
  }, []);

  const autoCount = rows.filter(r => r.method === 'auto').length;
  const manualCount = rows.filter(r => r.method === 'manual').length;

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Applications</h1>
          <p className={styles.pageDesc}>Full history of every job application submitted through the pipeline.</p>
        </div>
        <div className={styles.stats}>
          <div className={styles.statPill}>
            <span className={styles.statVal}>{rows.length}</span>
            <span className={styles.statLabel}>total</span>
          </div>
          <div className={styles.statPill}>
            <span className={styles.statVal} style={{ color: 'var(--success)' }}>{autoCount}</span>
            <span className={styles.statLabel}>auto-applied</span>
          </div>
          <div className={styles.statPill}>
            <span className={styles.statVal} style={{ color: 'var(--accent)' }}>{manualCount}</span>
            <span className={styles.statLabel}>manual</span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className={styles.empty}>Loading applications…</div>
      ) : rows.length === 0 ? (
        <div className={styles.empty}>No applications yet. Auto-applied and manually applied jobs will appear here.</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Job</th>
                <th className={styles.th}>Company</th>
                <th className={styles.th}>Method</th>
                <th className={styles.th}>CV</th>
                <th className={styles.th}>Score</th>
                <th className={styles.th}>Applied</th>
                <th className={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id} className={styles.tr}>
                  <td className={styles.td}>{row.job?.title ?? '—'}</td>
                  <td className={styles.td}>{row.job?.company ?? '—'}</td>
                  <td className={styles.td}>
                    <span className={`${styles.methodTag} ${row.method === 'auto' ? styles.methodAuto : styles.methodManual}`}>
                      {row.method === 'auto' ? 'Auto' : 'Manual'}
                    </span>
                  </td>
                  <td className={styles.td}>{row.cv?.label ?? '—'}</td>
                  <td className={styles.td}>
                    {row.job?.match_score != null ? (
                      <span style={{
                        fontFamily: 'var(--font-data)',
                        fontWeight: 600,
                        color: row.job.match_score >= 0.75 ? 'var(--success)'
                             : row.job.match_score >= 0.5  ? 'var(--accent)'
                             : 'var(--pending)',
                      }}>
                        {Math.round(row.job.match_score * 100)}%
                      </span>
                    ) : <span className={styles.tdMuted}>—</span>}
                  </td>
                  <td className={styles.td}>{formatDateTime(row.applied_at)}</td>
                  <td className={styles.td}>
                    {row.job?.url && (
                      <a href={row.job.url} target="_blank" rel="noopener noreferrer" className={styles.link}>
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
