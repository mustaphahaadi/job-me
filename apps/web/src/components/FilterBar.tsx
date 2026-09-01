import { useState, useRef, useEffect } from 'react';
import { ChevronDown, RotateCcw, Search } from 'lucide-react';
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
  defaultDaysOld?: number;
  onChange: (filters: FilterState) => void;
}

/**
 * Top filter bar — source multi-select, role keyword, days-old range, match score threshold.
 */
export function FilterBar({ sources, filters, defaultDaysOld = 14, onChange }: Props) {
  const [sourceOpen, setSourceOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isFiltered =
    filters.sourceIds.length > 0 ||
    filters.roleKeyword.trim() !== '' ||
    filters.minMatchScore > 0 ||
    filters.maxDaysOld !== defaultDaysOld;

  // Click-outside to close the source dropdown
  useEffect(() => {
    if (!sourceOpen) return;
    function handleMouseDown(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setSourceOpen(false);
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [sourceOpen]);

  function update(partial: Partial<FilterState>) {
    onChange({ ...filters, ...partial });
  }

  function toggleSource(id: string) {
    const ids = filters.sourceIds.includes(id)
      ? filters.sourceIds.filter(s => s !== id)
      : [...filters.sourceIds, id];
    update({ sourceIds: ids });
  }

  function resetFilters() {
    onChange({
      sourceIds: [],
      roleKeyword: '',
      maxDaysOld: defaultDaysOld,
      minMatchScore: 0,
      sortBy: 'scraped_at',
    });
  }

  return (
    <div className={styles.bar} role="search" aria-label="Job filters">
      {/* Source dropdown */}
      <div className={styles.filterGroup}>
        <label className={styles.label} htmlFor="filter-source-btn">Source</label>
        <div className={styles.dropdown} ref={dropdownRef}>
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
        <div className={styles.inputWrapper}>
          <Search size={13} className={styles.searchIcon} />
          <input
            id="filter-keyword"
            className={`${styles.input} ${styles.inputWithIcon}`}
            type="search"
            placeholder="e.g. DevOps"
            value={filters.roleKeyword}
            onChange={e => update({ roleKeyword: e.target.value })}
            aria-label="Filter by role keyword"
          />
        </div>
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

      {/* Reset button */}
      {isFiltered && (
        <div className={styles.filterGroup}>
          <button
            type="button"
            className={styles.resetBtn}
            onClick={resetFilters}
            aria-label="Reset all filters"
          >
            <RotateCcw size={13} />
            <span>Reset</span>
          </button>
        </div>
      )}
    </div>
  );
}

