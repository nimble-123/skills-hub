import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { commands, type ItemContent, type ItemMetadata } from "../../bindings";
import { estimateTokens, formatBytes, formatDate } from "../../lib/format";
import { reportError } from "../../stores/errors";
import { useUi } from "../../stores/ui";
import { TOOL_META, TYPE_META } from "../../toolMeta";
import { Icon } from "../common/Icon";
import { ProjectLinks } from "./ProjectLinks";
import styles from "./Rail.module.css";
import { TagEditor } from "./TagEditor";

type DetailRailProps = {
  item: ItemMetadata;
};

export function DetailRail({ item }: DetailRailProps) {
  const close = useUi((ui) => ui.select);
  const content = useItemContent(item.entryId);

  return (
    <aside className={styles.rail} aria-label={`Details for ${item.name}`}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>{item.name}</h2>
          <button
            type="button"
            className={styles.iconButton}
            title="Show in Finder"
            aria-label="Show in Finder"
            onClick={() => void reveal(item.sourcePath)}
          >
            <Icon name="folder-open" size={15} />
          </button>
          <button
            type="button"
            className={styles.iconButton}
            title="Close (Esc)"
            aria-label="Close the details"
            onClick={() => close(null)}
          >
            <Icon name="x" size={15} />
          </button>
        </div>
        {item.description && <p className={styles.description}>{item.description}</p>}
      </div>

      <div className={styles.scroll}>
        <dl className={styles.band}>
          <dt className={styles.bandKey}>Type</dt>
          <dd className={styles.bandValue}>{TYPE_META[item.type].label}</dd>

          <dt className={styles.bandKey}>Tool</dt>
          <dd className={styles.bandValue}>{TOOL_META[item.tool]?.label ?? item.tool}</dd>

          <dt className={styles.bandKey}>State</dt>
          <dd className={styles.bandValue}>{item.enabled ? "Enabled" : "Disabled"}</dd>

          {content.state === "ready" && (
            <>
              <dt className={styles.bandKey}>Size</dt>
              <dd className={styles.bandValue}>
                {formatBytes(content.data.bytes ?? 0)} · {estimateTokens(content.data.raw.length)}{" "}
                tokens
              </dd>

              <dt className={styles.bandKey}>Changed</dt>
              <dd className={styles.bandValue}>{formatDate(content.data.modified)}</dd>
            </>
          )}

          <dt className={styles.bandKey}>Path</dt>
          <dd className={`${styles.bandValue} ${styles.pathValue}`}>{item.sourcePath}</dd>

          {item.realPath !== item.sourcePath && (
            <>
              <dt className={styles.bandKey}>Links to</dt>
              <dd className={`${styles.bandValue} ${styles.pathValue}`}>{item.realPath}</dd>
            </>
          )}

          {item.sourceRepo && (
            <>
              <dt className={styles.bandKey}>From</dt>
              <dd className={`${styles.bandValue} ${styles.pathValue}`}>{item.sourceRepo}</dd>
            </>
          )}
        </dl>

        <div className={styles.sectionTitle}>Tags</div>
        <TagEditor item={item} />

        <ProjectLinks item={item} />

        {content.state === "loading" && <div className={styles.loading}>Reading the file…</div>}
        {content.state === "failed" && <div className={styles.failed}>{content.message}</div>}

        {content.state === "ready" && (
          <>
            {content.data.frontmatter.length > 0 && (
              <details className={styles.disclosure}>
                <summary>{content.data.frontmatter.length} frontmatter fields</summary>
                <div className={styles.fields}>
                  {content.data.frontmatter.map((field) => (
                    <div key={field.key} style={{ display: "contents" }}>
                      <span className={styles.fieldKey}>{field.key}</span>
                      <span className={styles.fieldValue}>{field.value}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {content.data.siblingFiles.length > 0 && (
              <>
                <div className={styles.sectionTitle}>
                  {content.data.siblingFiles.length} other files
                </div>
                <div className={styles.files}>
                  {content.data.siblingFiles.map((file) => (
                    <div key={file.path} className={styles.file}>
                      <span className={styles.fileName}>{file.path}</span>
                      <span className={styles.fileSize}>{formatBytes(file.bytes ?? 0)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className={styles.sectionTitle}>Content</div>
            <div className={styles.body}>
              {/*
                No rehype-raw: this content comes from arbitrary repositories,
                and raw HTML in a webview is a way into the command surface.
              */}
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                {content.data.body}
              </ReactMarkdown>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

type ContentState =
  | { state: "loading" }
  | { state: "ready"; data: ItemContent }
  | { state: "failed"; message: string };

/** Reads an item's file, and forgets it again when the selection changes. */
function useItemContent(entryId: string): ContentState {
  const [content, setContent] = useState<ContentState>({ state: "loading" });

  useEffect(() => {
    let current = true;
    setContent({ state: "loading" });

    void commands.readItemContent(entryId).then((result) => {
      // The selection moved on while this was in flight.
      if (!current) return;
      setContent(
        result.status === "ok"
          ? { state: "ready", data: result.data }
          : { state: "failed", message: result.error.message },
      );
    });

    return () => {
      current = false;
    };
  }, [entryId]);

  return content;
}

async function reveal(path: string) {
  const result = await commands.revealInFileManager(path, false);
  if (result.status === "error") reportError(result.error);
}
