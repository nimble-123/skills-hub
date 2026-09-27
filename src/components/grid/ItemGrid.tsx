import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef, useState } from "react";
import type { ItemMetadata } from "../../bindings";
import { Card } from "./Card";
import styles from "./Grid.module.css";

const MIN_CARD_WIDTH = 280;
const GAP = 12;
const ESTIMATED_ROW_HEIGHT = 168;

type ItemGridProps = {
  items: ItemMetadata[];
  selected: string | null;
  projectNames: Map<string, string>;
  onSelect: (entryId: string) => void;
};

/**
 * The card grid, virtualised by row.
 *
 * A library of a few hundred items is fifteen thousand DOM nodes rendered
 * whole, which is survivable but felt on every keystroke. Rendering only the
 * visible rows keeps filtering instant, and retrofitting it later would mean
 * rewriting the grid and its scroll handling.
 */
export function ItemGrid({ items, selected, projectNames, onSelect }: ItemGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const columns = useColumnCount(scrollRef);
  const rowCount = Math.ceil(items.length / columns);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT + GAP,
    overscan: 3,
  });

  return (
    <div className={styles.scroller} ref={scrollRef}>
      {items.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>Nothing here</div>
          <div>No item matches what you have selected.</div>
        </div>
      ) : (
        <div className={styles.rows} style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((row) => {
            const start = row.index * columns;
            const inRow = items.slice(start, start + columns);
            return (
              <div
                key={row.key}
                ref={virtualizer.measureElement}
                data-index={row.index}
                className={styles.row}
                style={{
                  transform: `translateY(${row.start}px)`,
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                }}
              >
                {inRow.map((item) => (
                  <Card
                    key={item.entryId}
                    item={item}
                    selected={item.entryId === selected}
                    projectName={
                      item.projectId === null ? undefined : projectNames.get(item.projectId)
                    }
                    onSelect={() => onSelect(item.entryId)}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** How many cards fit across, recomputed as the window resizes. */
function useColumnCount(ref: React.RefObject<HTMLDivElement | null>): number {
  const [columns, setColumns] = useState(1);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const measure = () => {
      const width = element.clientWidth;
      const fits = Math.floor((width + GAP) / (MIN_CARD_WIDTH + GAP));
      setColumns(Math.max(1, fits));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return columns;
}
