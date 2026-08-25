import { useState, useEffect, useRef } from 'react';
import { Upload, Star } from 'lucide-react';
import type { CvVersion } from '@job-me/shared';
import { supabase } from '../lib/supabase';
import styles from './CvVersions.module.css';

const ROLE_OPTIONS = ['Cloud Engineer', 'DevOps Engineer', 'AWS Technical Trainer'];

function formatDate(dt: string): string {
  return new Date(dt).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

/**
 * /cv — upload and manage CV versions.
 */
export default function CvVersions() {
  const [cvVersions, setCvVersions] = useState<CvVersion[]>([]);
  const [uploading, setUploading] = useState(false);
  const [label, setLabel] = useState('');
  const [roleTags, setRoleTags] = useState<string[]>([]);
  const [isDefaultFor, setIsDefaultFor] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void supabase.from('cv_versions').select('*').order('uploaded_at', { ascending: false })
      .then(({ data }) => { if (data) setCvVersions(data as CvVersion[]); });
  }, []);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file || !label.trim()) return;
    setUploading(true);

    const filePath = `${Date.now()}-${file.name}`;
    const { error: uploadErr } = await supabase.storage.from('cv-files').upload(filePath, file);
    if (uploadErr) {
      alert(`Upload failed: ${uploadErr.message}`);
      setUploading(false);
      return;
    }

    const { data } = await supabase.from('cv_versions').insert({
      label: label.trim(),
      file_path: filePath,
      role_tags: roleTags,
      is_default_for: isDefaultFor,
    }).select().single();

    if (data) setCvVersions(prev => [data as CvVersion, ...prev]);
    setLabel('');
    setRoleTags([]);
    setIsDefaultFor([]);
    if (fileRef.current) fileRef.current.value = '';
    setUploading(false);
  }

  async function handleSetDefault(cvId: string, role: string) {
    // Remove this role from all other CVs first
    const others = cvVersions.filter(cv => cv.id !== cvId && cv.is_default_for.includes(role));
    await Promise.all(others.map(cv =>
      supabase.from('cv_versions').update({
        is_default_for: cv.is_default_for.filter(r => r !== role),
      }).eq('id', cv.id)
    ));

    const target = cvVersions.find(cv => cv.id === cvId)!;
    const newDefault = target.is_default_for.includes(role)
      ? target.is_default_for.filter(r => r !== role)
      : [...target.is_default_for, role];

    await supabase.from('cv_versions').update({ is_default_for: newDefault }).eq('id', cvId);
    setCvVersions(prev => prev.map(cv => {
      if (cv.id === cvId) return { ...cv, is_default_for: newDefault };
      if (others.find(o => o.id === cv.id)) return { ...cv, is_default_for: cv.is_default_for.filter(r => r !== role) };
      return cv;
    }));
  }

  async function getSignedUrl(filePath: string) {
    const { data } = await supabase.storage.from('cv-files').createSignedUrl(filePath, 60);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>CV Versions</h1>
          <p className={styles.pageDesc}>Upload and manage CV files. Set a default per role so auto-apply and manual review pick the right one.</p>
        </div>
      </div>

      {/* ── Upload form ──────────────────────────────────────────── */}
      <form className={styles.uploadCard} onSubmit={handleUpload}>
        <h2 className={styles.sectionTitle}>Upload new CV</h2>
        <div className={styles.formRow}>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="cv-label">Label</label>
            <input id="cv-label" className={styles.input} required placeholder="e.g. Cloud Engineer — Aug 2026"
              value={label} onChange={e => setLabel(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="cv-file">File (PDF)</label>
            <input id="cv-file" className={styles.fileInput} type="file" accept=".pdf,.doc,.docx" required ref={fileRef} />
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel}>Role tags</label>
          <div className={styles.tagGroup}>
            {ROLE_OPTIONS.map(role => (
              <label key={role} className={styles.checkLabel}>
                <input type="checkbox" checked={roleTags.includes(role)}
                  onChange={() => setRoleTags(prev => prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role])}
                  style={{ accentColor: 'var(--accent)' }} />
                {role}
              </label>
            ))}
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel}>Set as default for</label>
          <div className={styles.tagGroup}>
            {ROLE_OPTIONS.map(role => (
              <label key={role} className={styles.checkLabel}>
                <input type="checkbox" checked={isDefaultFor.includes(role)}
                  onChange={() => setIsDefaultFor(prev => prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role])}
                  style={{ accentColor: 'var(--accent)' }} />
                {role}
              </label>
            ))}
          </div>
        </div>

        <button id="cv-upload-btn" type="submit" className={styles.uploadBtn} disabled={uploading}>
          <Upload size={14} />
          {uploading ? 'Uploading…' : 'Upload CV'}
        </button>
      </form>

      {/* ── CV list ──────────────────────────────────────────────── */}
      <div className={styles.cvList}>
        {cvVersions.length === 0 ? (
          <p className={styles.empty}>No CVs uploaded yet. Upload your first CV above.</p>
        ) : (
          cvVersions.map(cv => (
            <div key={cv.id} id={`cv-${cv.id}`} className={styles.cvCard}>
              <div className={styles.cvTop}>
                <div>
                  <button className={styles.cvLabel} onClick={() => getSignedUrl(cv.file_path)}>
                    {cv.label}
                  </button>
                  <div className={styles.cvMeta}>
                    Uploaded {formatDate(cv.uploaded_at)}
                    {cv.role_tags.length > 0 && ` · ${cv.role_tags.join(', ')}`}
                  </div>
                </div>
              </div>
              <div className={styles.defaultRow}>
                <span className={styles.defaultLabel}>Default for:</span>
                {ROLE_OPTIONS.map(role => {
                  const isDefault = cv.is_default_for.includes(role);
                  return (
                    <button
                      key={role}
                      id={`cv-default-${cv.id}-${role.replace(/\s/g, '-')}`}
                      className={`${styles.defaultBtn} ${isDefault ? styles.defaultBtnActive : ''}`}
                      onClick={() => handleSetDefault(cv.id, role)}
                      title={isDefault ? `Remove as default for ${role}` : `Set as default for ${role}`}
                    >
                      <Star size={10} fill={isDefault ? 'currentColor' : 'none'} />
                      {role}
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
