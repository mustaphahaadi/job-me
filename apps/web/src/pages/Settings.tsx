import { useState, useEffect } from 'react';
import type { Settings } from '@job-me/shared';
import { supabase } from '../lib/supabase';
import styles from './Settings.module.css';

const EMPTY_SETTINGS: Settings = {
  id: 1,
  target_roles: ['Cloud Engineer', 'DevOps Engineer', 'AWS Technical Trainer', 'AWS Instructor'],
  days_posted_default: 14,
  auto_apply_score_threshold: 0.75,
};

/**
 * /settings — target roles, days-posted default, auto-apply threshold, notification stub.
 */
export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(EMPTY_SETTINGS);
  const [newRole, setNewRole] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void supabase.from('settings').select('*').eq('id', 1).single()
      .then(({ data }) => { if (data) setSettings(data as Settings); });
  }, []);

  function addRole() {
    const trimmed = newRole.trim();
    if (!trimmed || settings.target_roles.includes(trimmed)) return;
    setSettings(s => ({ ...s, target_roles: [...s.target_roles, trimmed] }));
    setNewRole('');
  }

  function removeRole(role: string) {
    setSettings(s => ({ ...s, target_roles: s.target_roles.filter(r => r !== role) }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await supabase.from('settings').update({
      target_roles: settings.target_roles,
      days_posted_default: settings.days_posted_default,
      auto_apply_score_threshold: settings.auto_apply_score_threshold,
    }).eq('id', 1);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Settings</h1>
        <p className={styles.pageDesc}>Configure your job search criteria and auto-apply rules.</p>
      </div>

      <form onSubmit={handleSave} className={styles.form}>
        {/* ── Target roles ────────────────────────────────────────── */}
        <section className={styles.section} id="settings-target-roles">
          <h2 className={styles.sectionTitle}>Target roles</h2>
          <p className={styles.sectionDesc}>Keywords used to match job titles. Title match is the strongest scoring signal.</p>
          <div className={styles.roleList}>
            {settings.target_roles.map(role => (
              <div key={role} className={styles.roleTag}>
                <span>{role}</span>
                <button type="button" className={styles.removeBtn} onClick={() => removeRole(role)} aria-label={`Remove ${role}`}>
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className={styles.addRoleRow}>
            <input
              id="settings-add-role"
              className={styles.input}
              placeholder="Add a role keyword"
              value={newRole}
              onChange={e => setNewRole(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRole(); } }}
            />
            <button type="button" id="settings-add-role-btn" className={styles.addBtn} onClick={addRole}>
              Add role
            </button>
          </div>
        </section>

        <hr className={styles.divider} />

        {/* ── Days-posted default ──────────────────────────────────── */}
        <section className={styles.section} id="settings-days-posted">
          <h2 className={styles.sectionTitle}>Default days-since-posted filter</h2>
          <p className={styles.sectionDesc}>Jobs older than this are hidden from the dashboard by default. You can override per-session in the filter bar.</p>
          <div className={styles.sliderRow}>
            <input
              id="settings-days-input"
              className={styles.input}
              type="number"
              min={1}
              max={180}
              value={settings.days_posted_default}
              onChange={e => setSettings(s => ({ ...s, days_posted_default: Number(e.target.value) }))}
              style={{ width: 80 }}
            />
            <span className={styles.sliderUnit}>days</span>
          </div>
        </section>

        <hr className={styles.divider} />

        {/* ── Auto-apply threshold ─────────────────────────────────── */}
        <section className={styles.section} id="settings-auto-apply-threshold">
          <h2 className={styles.sectionTitle}>Auto-apply score threshold</h2>
          <p className={styles.sectionDesc}>
            Jobs must score at or above this threshold to be eligible for auto-apply.
            Below this, jobs always go to Manual Queue regardless of whether a connector exists.
          </p>
          <div className={styles.sliderRow}>
            <input
              id="settings-threshold-range"
              className={styles.range}
              type="range"
              min={0}
              max={100}
              value={Math.round(settings.auto_apply_score_threshold * 100)}
              onChange={e => setSettings(s => ({ ...s, auto_apply_score_threshold: Number(e.target.value) / 100 }))}
              aria-label="Auto-apply score threshold"
              aria-valuetext={`${Math.round(settings.auto_apply_score_threshold * 100)}%`}
            />
            <span className={styles.rangeValue}>
              {Math.round(settings.auto_apply_score_threshold * 100)}%
            </span>
          </div>
        </section>

        <hr className={styles.divider} />

        {/* ── Notifications (stub) ─────────────────────────────────── */}
        <section className={styles.section} id="settings-notifications">
          <h2 className={styles.sectionTitle}>Email digest</h2>
          <p className={styles.sectionDesc}>Receive a daily summary of new Manual Queue items and auto-apply results.</p>
          <div className={styles.stubNote}>
            Email digest — coming in a future update.
          </div>
        </section>

        {/* ── Save ─────────────────────────────────────────────────── */}
        <div className={styles.saveRow}>
          <button id="settings-save-btn" type="submit" className={styles.saveBtn} disabled={saving}>
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save settings'}
          </button>
        </div>
      </form>
    </div>
  );
}
