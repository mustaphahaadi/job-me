import { useState, useEffect } from 'react';
import { Plus, Play, AlertTriangle, CheckCircle, XCircle, ToggleLeft, ToggleRight, Trash2 } from 'lucide-react';
import type { Source } from '@job-me/shared';
import { supabase } from '../lib/supabase';
import { triggerScrapeNow } from '../lib/github';
import styles from './Sources.module.css';

type FormState = Omit<Source, 'id' | 'last_scraped_at' | 'last_scrape_status' | 'last_scrape_error' | 'consecutive_fail_count' | 'created_at'>;

const EMPTY_FORM: FormState = {
  name: '',
  type: 'rss',
  base_url: '',
  query_params: {},
  active: true,
};

function formatDateTime(dt: string | null): string {
  if (!dt) return 'Never';
  return new Date(dt).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/**
 * /sources — manage job board sources.
 */
export default function Sources() {
  const [sources, setSources] = useState<Source[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [paramStr, setParamStr] = useState('{}');

  useEffect(() => {
    void supabase.from('sources').select('*').order('name').then(({ data }) => {
      if (data) setSources(data as Source[]);
    });
  }, []);

  function openAdd() {
    setEditId(null);
    setForm(EMPTY_FORM);
    setParamStr('{}');
    setShowForm(true);
  }

  function openEdit(src: Source) {
    setEditId(src.id);
    setForm({ name: src.name, type: src.type, base_url: src.base_url, query_params: src.query_params, active: src.active });
    setParamStr(JSON.stringify(src.query_params, null, 2));
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    
    // Validate JSON query params
    let params: Record<string, unknown> = {};
    try {
      params = JSON.parse(paramStr) as Record<string, unknown>;
      if (typeof params !== 'object' || params === null || Array.isArray(params)) {
        throw new Error('Query params must be a valid JSON object');
      }
    } catch (err) {
      setSaveError('Invalid JSON in query params. Must be a valid JSON object, e.g., {"q": "devops", "l": "Remote"}');
      setSaving(false);
      return;
    }

    const payload = { ...form, query_params: params };
    if (editId) {
      const { data, error } = await supabase.from('sources').update(payload).eq('id', editId).select().single();
      if (error) { setSaveError(error.message); setSaving(false); return; }
      if (data) setSources(prev => prev.map(s => s.id === editId ? data as Source : s));
    } else {
      const { data, error } = await supabase.from('sources').insert(payload).select().single();
      if (error) { setSaveError(error.message); setSaving(false); return; }
      if (data) setSources(prev => [...prev, data as Source]);
    }
    setSaving(false);
    setShowForm(false);
  }

  async function handleDelete(src: Source) {
    if (!confirm(`Delete source "${src.name}"? This cannot be undone.`)) return;
    setDeletingId(src.id);
    const { error } = await supabase.from('sources').delete().eq('id', src.id);
    if (error) {
      alert(`Failed to delete: ${error.message}`);
    } else {
      setSources(prev => prev.filter(s => s.id !== src.id));
    }
    setDeletingId(null);
  }

  async function handleToggleActive(src: Source) {
    await supabase.from('sources').update({ active: !src.active }).eq('id', src.id);
    setSources(prev => prev.map(s => s.id === src.id ? { ...s, active: !s.active } : s));
  }

  async function handleRunNow(src: Source) {
    setTriggeringId(src.id);
    try {
      await triggerScrapeNow();
    } finally {
      setTriggeringId(null);
    }
  }

  async function handleRunAll() {
    setTriggeringId('all');
    try {
      await triggerScrapeNow();
      alert('Triggered pipeline scrape run for all active sources via GitHub Actions.');
    } catch (err) {
      console.error('[handleRunAll] failed:', err);
      alert('Failed to trigger scrape run. Check VITE_GITHUB_PAT setting.');
    } finally {
      setTriggeringId(null);
    }
  }

  const failedSources = sources.filter(s =>
    s.consecutive_fail_count >= 3
  );

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Sources</h1>
          <p className={styles.pageDesc}>Configure job boards to scrape. Each active source runs every 6 hours via GitHub Actions.</p>
        </div>
        <div className={styles.headerBtnGroup}>
          <button
            id="sources-run-all-btn"
            className={styles.runAllBtn}
            onClick={handleRunAll}
            disabled={triggeringId === 'all'}
            title="Trigger full scrape pipeline run for all active sources via GitHub Actions"
          >
            <Play size={14} />
            {triggeringId === 'all' ? 'Triggering all…' : 'Run all sources'}
          </button>
          <button id="sources-add-btn" className={styles.addBtn} onClick={openAdd}>
            <Plus size={14} />
            Add source
          </button>
        </div>
      </div>

      {failedSources.length > 0 && (
        <div className={styles.alertBanner}>
          <AlertTriangle size={14} />
          {failedSources.length === 1
            ? `Last scrape of "${failedSources[0]!.name}" failed. Check the source config.`
            : `${failedSources.length} sources failed their last scrape. Review below.`}
        </div>
      )}

      <div className={styles.sourceList}>
        {sources.length === 0 ? (
          <p className={styles.empty}>No sources configured. Add a source to start scraping jobs.</p>
        ) : (
          sources.map(src => {
            const failedThrice = src.consecutive_fail_count >= 3;
            return (
              <div key={src.id} id={`source-${src.id}`} className={styles.sourceCard}>
                <div className={styles.sourceTop}>
                  <div className={styles.sourceInfo}>
                    <span className={styles.sourceName}>{src.name}</span>
                    <span className={styles.sourceType}>{src.type.toUpperCase()}</span>
                  </div>
                  <div className={styles.sourceActions}>
                    <button
                      id={`source-runnow-${src.id}`}
                      className={styles.runNowBtn}
                      onClick={() => handleRunNow(src)}
                      disabled={triggeringId === src.id}
                      title="Trigger scrape now via GitHub Actions"
                    >
                      <Play size={12} />
                      {triggeringId === src.id ? 'Triggering…' : 'Run now'}
                    </button>
                    <button
                      id={`source-toggle-${src.id}`}
                      className={styles.toggleBtn}
                      onClick={() => handleToggleActive(src)}
                      title={src.active ? 'Deactivate source' : 'Activate source'}
                    >
                      {src.active
                        ? <ToggleRight size={18} style={{ color: 'var(--success)' }} />
                        : <ToggleLeft size={18} style={{ color: 'var(--text-muted)' }} />}
                    </button>
                    <button
                      id={`source-delete-${src.id}`}
                      className={styles.deleteBtn}
                      onClick={() => handleDelete(src)}
                      disabled={deletingId === src.id}
                      title="Delete source"
                    >
                      <Trash2 size={12} />
                    </button>
                    <button
                      id={`source-edit-${src.id}`}
                      className={styles.editBtn}
                      onClick={() => openEdit(src)}
                    >
                      Edit
                    </button>
                  </div>
                </div>

                <div className={styles.sourceMeta}>
                  <span className={styles.metaItem}>{src.base_url}</span>
                  <span className={styles.metaItem}>
                    Last scraped: {formatDateTime(src.last_scraped_at)}
                  </span>
                  <span className={styles.metaItem}>
                    {src.last_scrape_status === 'success'
                      ? <><CheckCircle size={11} style={{ color: 'var(--success)' }} /> Success</>
                      : src.last_scrape_status === 'failed'
                      ? <><XCircle size={11} style={{ color: 'var(--danger)' }} /> Failed</>
                      : '—'}
                  </span>
                </div>

                {failedThrice && src.last_scrape_error && (
                  <div className={styles.scrapeError}>
                    Last scrape of &quot;{src.name}&quot; failed. Check the source config.
                    <pre className={styles.errorText}>{src.last_scrape_error}</pre>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* ── Add/edit form modal ─────────────────────────────────── */}
      {showForm && (
        <>
          <div className={styles.modalBackdrop} onClick={() => setShowForm(false)} />
          <div className={styles.modal} role="dialog" aria-label={editId ? 'Edit source' : 'Add source'}>
            <h2 className={styles.modalTitle}>{editId ? 'Edit source' : 'Add source'}</h2>
            <form onSubmit={handleSubmit} className={styles.form}>
              {saveError && (
                <div className={styles.formError}>{saveError}</div>
              )}
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="src-name">Name</label>
                <input id="src-name" className={styles.input} required value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="src-type">Type</label>
                <select id="src-type" className={styles.select} value={form.type}
                  onChange={e => setForm(f => ({ ...f, type: e.target.value as Source['type'] }))}>
                  <option value="rss">RSS</option>
                  <option value="api">API (Generic)</option>
                  <option value="jobicy">Jobicy</option>
                  <option value="arbeitnow">Arbeitnow</option>
                  <option value="linkedin">LinkedIn</option>
                  <option value="indeed">Indeed</option>
                  <option value="otta">Otta</option>
                  <option value="glassdoor">Glassdoor (RSS)</option>
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="src-url">Base URL</label>
                <input id="src-url" className={styles.input} required type="url" value={form.base_url}
                  onChange={e => setForm(f => ({ ...f, base_url: e.target.value }))} />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="src-params">Query params (JSON)</label>
                <textarea id="src-params" className={styles.textarea} value={paramStr}
                  onChange={e => setParamStr(e.target.value)} rows={4} />
              </div>
              <div className={styles.formActions}>
                <button type="button" className={styles.cancelBtn} onClick={() => setShowForm(false)}>Cancel</button>
                <button id="src-save-btn" type="submit" className={styles.saveBtn} disabled={saving}>
                  {saving ? 'Saving…' : editId ? 'Save changes' : 'Add source'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
