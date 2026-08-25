import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Source } from '@job-me/shared';
import styles from './FilterBar.module.css';

export interface FilterState {
  sourceIds: string[];
  roleKeyword: string;
  maxDaysOld: number;
  minMatchScore: number;
  sortBy: 'scraped_at' | 'posted_date' | 'match_score' | 'days_old';
}

interface Props {
  sources: Source[];
  filters: FilterState;
  onChange: (filters: FilterState) => void;
}

/**
 * Top filter bar — source multi-select, role keyword, days-old range, match score threshold.
 */
export function FilterBar({ sources, filters, onChange }: Props) {
  const [sourceOpen, setSourceOpen] = useState(false);

  function update(partial: Partial<FilterState>) {
    onChange({ ...filters, ...partial });
  }

  function toggleSource(id: string) {
    const ids = filters.sourceIds.includes(id)
      ? filters.sourceIds.filter(s => s !== id)
      : [...filters.sourceIds, id];
    update({ sourceIds: ids });
  }

  return (
    <div className={styles.bar} role="search" aria-label="Job filters">
      {/* Source dropdown */}
      <div className={styles.filterGroup}>
        <label className={styles.label} htmlFor="filter-source-btn">Source</label>
        <div className={styles.dropdown}>
          <button
            id="filter-source-btn"
            className={styles.dropdownTrigger}
            onClick={() => setSourceOpen(o => !o)}
            aria-haspopup="listbox"
            aria-expanded={sourceOpen}
          >
            {filters.sourceIds.length === 0
              ? 'All sources'
              : `${filters.sourceIds.length} selected`}
            <ChevronDown size={14} className={sourceOpen ? styles.chevronOpen : ''} />
          </button>
          {sourceOpen && (
            <div className={styles.dropdownMenu} role="listbox" aria-multiselectable="true">
              {sources.map(src => (
                <label key={src.id} className={styles.dropdownItem} role="option" aria-selected={filters.sourceIds.includes(src.id)}>
                  <input
                    type="checkbox"
                    checked={filters.sourceIds.includes(src.id)}
                    onChange={() => toggleSource(src.id)}
                  />
                  {src.name}
                </label>
              ))}
              {sources.length === 0 && (
                <span className={styles.dropdownEmpty}>No sources configured</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Role keyword */}
      <div className={styles.filterGroup}>
        <label className={styles.label} htmlFor="filter-keyword">Role keyword</label>
        <input
          id="filter-keyword"
          className={styles.input}
          type="search"
          placeholder="e.g. DevOps"
          value={filters.roleKeyword}
          onChange={e => update({ roleKeyword: e.target.value })}
          aria-label="Filter by role keyword"
        />
      </div>

      {/* Days since posted */}
      <div className={styles.filterGroup}>
        <label className={styles.label} htmlFor="filter-days">
          Posted within
          <span className={styles.rangeValue}>{filters.maxDaysOld}d</span>
        </label>
        <input
          id="filter-days"
          className={styles.range}
          type="range"
          min={1}
          max={90}
          value={filters.maxDaysOld}
          onChange={e => update({ maxDaysOld: Number(e.target.value) })}
          aria-label="Maximum days since posted"
          aria-valuetext={`${filters.maxDaysOld} days`}
        />
      </div>

      {/* Match score threshold */}
      <div className={styles.filterGroup}>
        <label className={styles.label} htmlFor="filter-score">
          Min score
          <span className={styles.rangeValue}>{Math.round(filters.minMatchScore * 100)}%</span>
        </label>
        <input
          id="filter-score"
          className={styles.range}
          type="range"
          min={0}
          max={100}
          value={Math.round(filters.minMatchScore * 100)}
          onChange={e => update({ minMatchScore: Number(e.target.value) / 100 })}
          aria-label="Minimum match score"
          aria-valuetext={`${Math.round(filters.minMatchScore * 100)}%`}
        />
      </div>

      {/* Sort */}
      <div className={styles.filterGroup}>
        <label className={styles.label} htmlFor="filter-sort">Sort</label>
        <select
          id="filter-sort"
          className={styles.select}
          value={filters.sortBy}
          onChange={e => update({ sortBy: e.target.value as FilterState['sortBy'] })}
          aria-label="Sort jobs by"
        >
          <option value="scraped_at">Newest scanned</option>
          <option value="posted_date">Posted date</option>
          <option value="match_score">Match score</option>
          <option value="days_old">Days old</option>
        </select>
      </div>
    </div>
  );
}
