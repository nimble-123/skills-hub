import type { EnabledFilter, SortOrder } from "../../bindings";
import type { Facets } from "../../lib/library";
import { tagsByFrequency } from "../../lib/library";
import { useFilters } from "../../stores/filters";
import { Icon } from "../common/Icon";
import styles from "./Grid.module.css";

const ENABLED_OPTIONS: Array<[EnabledFilter, string]> = [
  ["all", "All"],
  ["enabled", "On"],
  ["disabled", "Off"],
];

const SORT_OPTIONS: Array<[SortOrder, string]> = [
  ["name-asc", "Name A→Z"],
  ["name-desc", "Name Z→A"],
  ["modified-desc", "Newest first"],
  ["modified-asc", "Oldest first"],
];

const SOURCE_OPTIONS = [
  ["all", "Any source"],
  ["tracked", "From GitHub"],
  ["plugin", "From a plugin"],
  ["local", "Written here"],
] as const;

type ToolbarProps = {
  facets: Facets;
  searchRef: React.RefObject<HTMLInputElement | null>;
};

export function Toolbar({ facets, searchRef }: ToolbarProps) {
  const filters = useFilters();
  const tags = tagsByFrequency(facets);

  return (
    <>
      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <span className={styles.searchIcon}>
            <Icon name="search" size={14} />
          </span>
          <input
            ref={searchRef}
            className={styles.search}
            type="search"
            placeholder="Search name and description…"
            value={filters.search}
            onChange={(event) => filters.setSearch(event.target.value)}
            aria-label="Search the library"
          />
          {filters.search !== "" && (
            <button
              type="button"
              className={styles.clear}
              onClick={() => filters.setSearch("")}
              aria-label="Clear the search"
            >
              <Icon name="x" size={14} />
            </button>
          )}
        </div>

        {/* No HTML element means "a set of related controls"; the ARIA role is
            the only way to say it. */}
        {/* biome-ignore lint/a11y/useSemanticElements: no semantic equivalent exists */}
        <div className={styles.segmented} role="group" aria-label="Enabled state">
          {ENABLED_OPTIONS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={
                filters.enabled === value
                  ? `${styles.segment} ${styles.segmentActive}`
                  : styles.segment
              }
              onClick={() => filters.setEnabled(value)}
              aria-pressed={filters.enabled === value}
            >
              {label}
            </button>
          ))}
        </div>

        <select
          className={styles.select}
          value={filters.source}
          onChange={(event) =>
            filters.setSource(event.target.value as (typeof SOURCE_OPTIONS)[number][0])
          }
          aria-label="Filter by where the item came from"
        >
          {SOURCE_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <select
          className={styles.select}
          value={filters.sort}
          onChange={(event) => filters.setSort(event.target.value as SortOrder)}
          aria-label="Sort order"
        >
          {SORT_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {(tags.length > 0 || facets.untagged > 0) && (
        <div className={styles.tagbar}>
          {facets.untagged > 0 && (
            <button
              type="button"
              className={filters.untagged ? `${styles.chip} ${styles.chipActive}` : styles.chip}
              onClick={filters.toggleUntagged}
              aria-pressed={filters.untagged}
            >
              Untagged {facets.untagged}
            </button>
          )}
          {tags.map(({ tag, count }) => (
            <button
              key={tag}
              type="button"
              className={filters.tag === tag ? `${styles.chip} ${styles.chipActive}` : styles.chip}
              onClick={() => filters.toggleTag(tag)}
              aria-pressed={filters.tag === tag}
            >
              {tag} {count}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
