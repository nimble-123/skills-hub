import { useEffect, useState } from "react";
import styles from "./Rail.module.css";

type CodeBlockProps = {
  code: string;
  language: string;
};

/**
 * A fenced code block, highlighted once its grammar has loaded.
 *
 * Plain text first, highlighted when ready: the grammar is a separate chunk,
 * and showing nothing while it loads would make a document of code blocks
 * flicker into existence.
 */
export function CodeBlock({ code, language }: CodeBlockProps) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    // Imported here rather than at the top: this pulls in shiki and a grammar,
    // and neither belongs in the startup bundle of a window that may never
    // show a code block.
    void import("../../lib/highlight")
      .then(({ highlight }) => highlight(code, language))
      .then((result) => {
        if (current) setHtml(result);
      })
      .catch(() => {
        // Highlighting is decoration; plain text is already on screen.
      });
    return () => {
      current = false;
    };
  }, [code, language]);

  if (html === null) {
    return (
      <pre className={styles.plainCode}>
        <code>{code}</code>
      </pre>
    );
  }

  return (
    <div
      className={styles.highlighted}
      // Shiki's output, generated here from the file's own text. It produces
      // spans and inline styles, and nothing from the source survives as
      // markup — the same reason rehype-raw stays switched off.
      // biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
