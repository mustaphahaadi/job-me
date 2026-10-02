import { useState, useEffect } from 'react';
import type { Settings } from '@job-me/shared';
import { DEFAULT_SKILL_VOCABULARY } from '@job-me/shared';
import { supabase } from '../lib/supabase';
import styles from './Settings.module.css';

const EMPTY_SETTINGS: Settings = {
  id: 1,
  target_roles: ['Software Engineer', 'Backend Engineer', 'Full Stack Engineer'],
  days_posted_default: 14,
  auto_apply_score_threshold: 0.75,
  max_auto_apply_per_run: 5,
  target_seniority: 'mid',
  accepted_locations: ['remote'],
  negative_keywords: [],
  skill_vocabulary: DEFAULT_SKILL_VOCABULARY,
};

const SENIORITY_OPTIONS: Array<{ value: Settings['target_seniority']; label: string }> = [
  { value: 'junior', label: 'Junior' },
  { value: 'mid',    label: 'Mid-level' },
  { value: 'senior', label: 'Senior' },
  { value: 'any',    label: 'Any level' },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(EMPTY_SETTINGS);
  const [newRole, setNewRole] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [newKeyword, setNewKeyword] = useState('');
  const [newSkill, setNewSkill] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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

  function addLocation() {
    const trimmed = newLocation.trim().toLowerCase();
    if (!trimmed || (settings.accepted_locations ?? []).includes(trimmed)) return;
    setSettings(s => ({ ...s, accepted_locations: [...(s.accepted_locations ?? []), trimmed] }));
    setNewLocation('');
  }

  function removeLocation(loc: string) {
    setSettings(s => ({ ...s, accepted_locations: (s.accepted_locations ?? []).filter(l => l !== loc) }));
  }

  function addKeyword() {
    const trimmed = newKeyword.trim().toLowerCase();
    if (!trimmed || (settings.negative_keywords ?? []).includes(trimmed)) return;
    setSettings(s => ({ ...s, negative_keywords: [...(s.negative_keywords ?? []), trimmed] }));
    setNewKeyword('');
  }

  function removeKeyword(kw: string) {
    setSettings(s => ({ ...s, negative_keywords: (s.negative_keywords ?? []).filter(k => k !== kw) }));
  }

  function addSkill() {
    const trimmed = newSkill.trim().toLowerCase();
    if (!trimmed || (settings.skill_vocabulary ?? DEFAULT_SKILL_VOCABULARY).includes(trimmed)) return;
    setSettings(s => ({ ...s, skill_vocabulary: [...(s.skill_vocabulary ?? DEFAULT_SKILL_VOCABULARY), trimmed] }));
    setNewSkill('');
  }

  function removeSkill(skill: string) {
    setSettings(s => ({ ...s, skill_vocabulary: (s.skill_vocabulary ?? DEFAULT_SKILL_VOCABULARY).filter(sk => sk !== skill) }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    const { error } = await supabase.from('settings').update({
      target_roles: settings.target_roles,
      days_posted_default: settings.days_posted_default,
      auto_apply_score_threshold: settings.auto_apply_score_threshold,
      max_auto_apply_per_run: settings.max_auto_apply_per_run,
      target_seniority: settings.target_seniority,
      accepted_locations: settings.accepted_locations,
      negative_keywords: settings.negative_keywords,
      skill_vocabulary: settings.skill_vocabulary,
    }).eq('id', 1);
    setSaving(false);
    if (error) {
      setSaveError(error.message);
    } else {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
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
          <div className={styles.presetGroup}>
            <span className={styles.presetLabel}>Quick add:</span>
            {['Software Engineer', 'Backend Engineer', 'Frontend Engineer', 'Full Stack Engineer', 'Data Engineer'].map(preset => (
              !settings.target_roles.includes(preset) && (
                <button key={preset} type="button" className={styles.presetChip}
                  onClick={() => setSettings(s => ({ ...s, target_roles: [...s.target_roles, preset] }))}>
                  + {preset}
                </button>
              )
            ))}
          </div>
          <div className={styles.addRoleRow}>
            <input id="settings-add-role" className={styles.input} placeholder="Add a role keyword"
              value={newRole} onChange={e => setNewRole(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRole(); } }} />
            <button type="button" id="settings-add-role-btn" className={styles.addBtn} onClick={addRole}>Add role</button>
          </div>
        </section>

        <hr className={styles.divider} />

        {/* ── Target seniority ─────────────────────────────────────── */}
        <section className={styles.section} id="settings-seniority">
          <h2 className={styles.sectionTitle}>Target seniority</h2>
          <p className={styles.sectionDesc}>Jobs at the wrong level are penalised in the match score. Adjacent levels get partial credit; mismatched levels are scored very low.</p>
          <div className={styles.seniorityRow}>
            {SENIORITY_OPTIONS.map(opt => (
              <label key={opt.value} className={`${styles.seniorityOption} ${settings.target_seniority === opt.value ? styles.senioritySelected : ''}`}>
                <input type="radio" name="target_seniority" value={opt.value}
                  checked={settings.target_seniority === opt.value}
                  onChange={() => setSettings(s => ({ ...s, target_seniority: opt.value }))}
                  className={styles.srOnly} />
                {opt.label}
              </label>
            ))}
          </div>
        </section>

        <hr className={styles.divider} />

        {/* ── Accepted locations ───────────────────────────────────── */}
        <section className={styles.section} id="settings-locations">
          <h2 className={styles.sectionTitle}>Accepted locations</h2>
          <p className={styles.sectionDesc}>Jobs outside these locations score 0 on the location signal. Use lowercase terms like "remote", "uk", "united kingdom". An empty list accepts all locations.</p>
          <div className={styles.roleList}>
            {(settings.accepted_locations ?? []).map(loc => (
              <div key={loc} className={styles.roleTag}>
                <span>{loc}</span>
                <button type="button" className={styles.removeBtn} onClick={() => removeLocation(loc)} aria-label={`Remove ${loc}`}>×</button>
              </div>
            ))}
          </div>
          <div className={styles.presetGroup}>
            <span className={styles.presetLabel}>Quick add:</span>
            {['remote', 'worldwide', 'us', 'uk', 'europe'].map(preset => (
              !(settings.accepted_locations ?? []).includes(preset) && (
                <button key={preset} type="button" className={styles.presetChip}
                  onClick={() => setSettings(s => ({ ...s, accepted_locations: [...(s.accepted_locations ?? []), preset] }))}>
                  + {preset}
                </button>
              )
            ))}
          </div>
          <div className={styles.addRoleRow}>
            <input id="settings-add-location" className={styles.input} placeholder="e.g. remote, uk, united kingdom"
              value={newLocation} onChange={e => setNewLocation(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLocation(); } }} />
            <button type="button" id="settings-add-location-btn" className={styles.addBtn} onClick={addLocation}>Add location</button>
          </div>
        </section>

        <hr className={styles.divider} />

        {/* ── Negative keywords ────────────────────────────────────── */}
        <section className={styles.section} id="settings-negative-keywords">
          <h2 className={styles.sectionTitle}>Negative keywords</h2>
          <p className={styles.sectionDesc}>Jobs matching any of these keywords in the title or description are immediately scored 0 and closed.</p>
          <div className={styles.roleList}>
            {(settings.negative_keywords ?? []).map(kw => (
              <div key={kw} className={`${styles.roleTag} ${styles.roleTagDanger}`}>
                <span>{kw}</span>
                <button type="button" className={styles.removeBtn} onClick={() => removeKeyword(kw)} aria-label={`Remove ${kw}`}>×</button>
              </div>
            ))}
            {(settings.negative_keywords ?? []).length === 0 && (
              <span className={styles.emptyNote}>No negative keywords configured.</span>
            )}
          </div>
          <div className={styles.presetGroup}>
            <span className={styles.presetLabel}>Quick add:</span>
            {['unpaid', 'clearance required', 'internship', 'volunteer'].map(preset => (
              !(settings.negative_keywords ?? []).includes(preset) && (
                <button key={preset} type="button" className={styles.presetChipDanger}
                  onClick={() => setSettings(s => ({ ...s, negative_keywords: [...(s.negative_keywords ?? []), preset] }))}>
                  + {preset}
                </button>
              )
            ))}
          </div>
          <div className={styles.addRoleRow}>
            <input id="settings-add-keyword" className={styles.input} placeholder="e.g. unpaid, clearance required"
              value={newKeyword} onChange={e => setNewKeyword(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addKeyword(); } }} />
            <button type="button" id="settings-add-keyword-btn" className={styles.addBtn} onClick={addKeyword}>Add keyword</button>
          </div>
        </section>

        <hr className={styles.divider} />

        {/* ── Skill vocabulary ─────────────────────────────────────── */}
        <section className={styles.section} id="settings-skill-vocabulary">
          <h2 className={styles.sectionTitle}>Skill vocabulary</h2>
          <p className={styles.sectionDesc}>Skills matched against job descriptions for the Skills Overlap scoring signal (30% weight). Add skills from your CV to improve match accuracy.</p>
          <div className={styles.roleList}>
            {(settings.skill_vocabulary ?? DEFAULT_SKILL_VOCABULARY).map(skill => (
              <div key={skill} className={styles.roleTag}>
                <span>{skill}</span>
                <button type="button" className={styles.removeBtn} onClick={() => removeSkill(skill)} aria-label={`Remove ${skill}`}>×</button>
              </div>
            ))}
          </div>
          <div className={styles.addRoleRow}>
            <input id="settings-add-skill" className={styles.input} placeholder="e.g. pulumi, argocd, vault"
              value={newSkill} onChange={e => setNewSkill(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSkill(); } }} />
            <button type="button" id="settings-add-skill-btn" className={styles.addBtn} onClick={addSkill}>Add skill</button>
          </div>
        </section>

        <hr className={styles.divider} />

        {/* ── Days-posted default ──────────────────────────────────── */}
        <section className={styles.section} id="settings-days-posted">
          <h2 className={styles.sectionTitle}>Default days-since-posted filter</h2>
          <p className={styles.sectionDesc}>Jobs older than this are hidden from the dashboard by default. You can override per-session in the filter bar.</p>
          <div className={styles.sliderRow}>
            <input id="settings-days-input" className={styles.input} type="number" min={1} max={180}
              value={settings.days_posted_default}
              onChange={e => setSettings(s => ({ ...s, days_posted_default: Number(e.target.value) }))}
              style={{ width: 80 }} />
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
            <input id="settings-threshold-range" className={styles.range} type="range" min={0} max={100}
              value={Math.round(settings.auto_apply_score_threshold * 100)}
              onChange={e => setSettings(s => ({ ...s, auto_apply_score_threshold: Number(e.target.value) / 100 }))}
              aria-label="Auto-apply score threshold"
              aria-valuetext={`${Math.round(settings.auto_apply_score_threshold * 100)}%`} />
            <span className={styles.rangeValue}>{Math.round(settings.auto_apply_score_threshold * 100)}%</span>
          </div>
        </section>

        <hr className={styles.divider} />

        {/* ── Max auto-apply per run ───────────────────────────────── */}
        <section className={styles.section} id="settings-max-auto-apply">
          <h2 className={styles.sectionTitle}>Max auto-apply per pipeline run</h2>
          <p className={styles.sectionDesc}>Maximum number of jobs the pipeline will auto-apply to in a single run. Keeps submission rate conservative to avoid ATS flags.</p>
          <div className={styles.sliderRow}>
            <input id="settings-max-auto-apply-input" className={styles.input} type="number" min={1} max={50}
              value={settings.max_auto_apply_per_run}
              onChange={e => setSettings(s => ({ ...s, max_auto_apply_per_run: Number(e.target.value) }))}
              style={{ width: 80 }} />
            <span className={styles.sliderUnit}>per run</span>
          </div>
        </section>

        {/* ── Save ─────────────────────────────────────────────────── */}
        <div className={styles.saveRow}>
          {saveError && <p className={styles.saveError}>{saveError}</p>}
          <button id="settings-save-btn" type="submit" className={styles.saveBtn} disabled={saving}>
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save settings'}
          </button>
        </div>
      </form>
    </div>
  );
}
