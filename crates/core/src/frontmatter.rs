//! A deliberately lenient YAML frontmatter reader.
//!
//! Not a YAML parser, and not a mistake. These files are written by hand and by
//! a dozen different tools, and only the first few kilobytes are read — so the
//! block being parsed is frequently truncated mid-document and would make a real
//! parser give up on the whole file. What is wanted instead is: take what is
//! legible, ignore what is not, never fail.
//!
//! Block scalars (`|`, `>`) and sequences are folded into one comma-joined line,
//! because these values exist to be displayed, not round-tripped.

use std::path::Path;

/// One declared frontmatter key, in the order it appeared.
///
/// Order is preserved so the detail view can show the block the way the author
/// wrote it, rather than alphabetised.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Field {
    pub key: String,
    pub value: String,
}

/// The two fields the scanner itself indexes on.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SourceMeta {
    pub name: String,
    pub description: String,
}

/// How much of a file is read to find its frontmatter.
///
/// Matches the Obsidian plugin, and is generous: a manifest whose frontmatter
/// does not start within 4 KiB does not have frontmatter worth waiting for.
pub const HEAD_BYTES: usize = 4096;

/// Parses the leading `---` block, if there is one.
#[must_use]
pub fn parse(raw: &str) -> Vec<Field> {
    let Some(block) = frontmatter_block(raw) else {
        return Vec::new();
    };

    let lines: Vec<&str> = block.lines().collect();
    let mut fields = Vec::new();
    let mut index = 0;

    while index < lines.len() {
        let Some((key, rest)) = split_key(lines[index]) else {
            index += 1;
            continue;
        };

        let value = if is_continued(rest) {
            let (folded, next) = fold_indented_block(&lines, index + 1);
            index = next;
            folded
        } else {
            index += 1;
            rest.trim().to_owned()
        };

        fields.push(Field {
            key,
            value: unquote(&value),
        });
    }

    fields
}

/// The `name` and `description` fields, empty when absent.
#[must_use]
pub fn parse_source_meta(raw: &str) -> SourceMeta {
    let fields = parse(raw);
    let get = |wanted: &str| {
        fields
            .iter()
            .find(|field| field.key == wanted)
            .map(|field| field.value.clone())
            .unwrap_or_default()
    };
    SourceMeta {
        name: get("name"),
        description: get("description"),
    }
}

/// Reads a file's head and parses its `name` and `description`.
///
/// An unreadable file yields empty metadata rather than an error: a manifest the
/// scanner cannot read is still an item the user can see and act on.
#[must_use]
pub fn read_source_meta(path: &Path) -> SourceMeta {
    read_head(path)
        .map(|head| parse_source_meta(&head))
        .unwrap_or_default()
}

/// Reads at most [`HEAD_BYTES`] of a file as UTF-8.
///
/// Truncation happens on a character boundary. Slicing a `String` at a fixed
/// byte offset panics when that offset lands inside a multi-byte character,
/// which for a file of prose is a matter of when, not whether.
#[must_use]
pub fn read_head(path: &Path) -> Option<String> {
    use std::io::Read as _;

    let mut file = std::fs::File::open(path).ok()?;
    let mut buffer = vec![0u8; HEAD_BYTES];
    let read = file.read(&mut buffer).ok()?;
    buffer.truncate(read);

    match String::from_utf8(buffer) {
        Ok(text) => Some(text),
        // A character split by the read boundary: keep everything before it.
        Err(err) => {
            let valid = err.utf8_error().valid_up_to();
            let mut bytes = err.into_bytes();
            bytes.truncate(valid);
            String::from_utf8(bytes).ok()
        }
    }
}

/// Everything after the frontmatter block.
///
/// This is the "instruction body" — what a tool loads once an item is invoked,
/// as opposed to the metadata it always has available.
#[must_use]
pub fn strip(raw: &str) -> &str {
    match locate_block(raw) {
        Some(span) => &raw[span.body_end..],
        None => raw,
    }
}

/// Where a frontmatter block sits within the text.
struct BlockSpan {
    /// Byte range of the text between the fences.
    body: std::ops::Range<usize>,
    /// First byte after the closing fence and its line break.
    body_end: usize,
}

/// Finds the leading `---` block, if the text opens with one.
fn locate_block(raw: &str) -> Option<BlockSpan> {
    let rest = raw
        .strip_prefix("---\n")
        .or_else(|| raw.strip_prefix("---\r\n"))?;
    let start = raw.len() - rest.len();

    let mut cursor = start;
    for line in rest.split_inclusive('\n') {
        if line.trim_end_matches(['\r', '\n']) == "---" {
            return Some(BlockSpan {
                body: start..cursor,
                body_end: cursor + line.len(),
            });
        }
        cursor += line.len();
    }
    // An unterminated block: the head read cut the file short. The keys seen so
    // far are still worth having, and there is no body after them.
    Some(BlockSpan {
        body: start..raw.len(),
        body_end: raw.len(),
    })
}

fn frontmatter_block(raw: &str) -> Option<&str> {
    locate_block(raw).map(|span| &raw[span.body])
}

fn split_key(line: &str) -> Option<(String, &str)> {
    let colon = line.find(':')?;
    let key = &line[..colon];
    if key.is_empty()
        || !key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return None;
    }
    Some((key.to_owned(), &line[colon + 1..]))
}

fn is_continued(rest: &str) -> bool {
    matches!(rest.trim(), "" | "|" | ">" | "|-" | ">-" | "|+" | ">+")
}

/// Folds the indented lines after a key into one comma-joined value.
fn fold_indented_block(lines: &[&str], from: usize) -> (String, usize) {
    let mut items = Vec::new();
    let mut index = from;
    while index < lines.len() {
        let line = lines[index];
        if line.trim().is_empty() || !line.starts_with([' ', '\t']) {
            break;
        }
        items.push(line.trim().trim_start_matches("- ").trim().to_owned());
        index += 1;
    }
    (items.join(", "), index)
}

fn unquote(value: &str) -> String {
    let trimmed = value.trim();
    let bytes = trimmed.as_bytes();
    if bytes.len() >= 2 {
        let first = trimmed.chars().next();
        let last = trimmed.chars().next_back();
        if matches!(
            (first, last),
            (Some('"'), Some('"')) | (Some('\''), Some('\''))
        ) {
            return trimmed[1..trimmed.len() - 1].to_owned();
        }
    }
    trimmed.to_owned()
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn reads_simple_scalars_in_order() {
        let raw = "---\nname: my-skill\ndescription: Does a thing\nmodel: opus\n---\n\nBody.\n";
        assert_eq!(
            parse(raw),
            vec![
                Field {
                    key: "name".into(),
                    value: "my-skill".into()
                },
                Field {
                    key: "description".into(),
                    value: "Does a thing".into()
                },
                Field {
                    key: "model".into(),
                    value: "opus".into()
                },
            ]
        );
    }

    #[test]
    fn strips_surrounding_quotes_of_either_kind() {
        let raw = "---\nname: \"quoted\"\nother: 'single'\n---\n";
        let meta = parse_source_meta(raw);
        assert_eq!(meta.name, "quoted");
        assert_eq!(parse(raw)[1].value, "single");
    }

    #[test]
    fn folds_a_block_sequence_into_one_line() {
        let raw = "---\nallowed-tools:\n  - Bash\n  - Read\n  - Edit\nname: x\n---\n";
        let fields = parse(raw);
        assert_eq!(fields[0].key, "allowed-tools");
        assert_eq!(fields[0].value, "Bash, Read, Edit");
        // Folding must not swallow the key that follows the block.
        assert_eq!(fields[1].key, "name");
    }

    #[test]
    fn folds_literal_and_folded_scalars() {
        for marker in ["|", ">", "|-", ">-"] {
            let raw =
                format!("---\ndescription: {marker}\n  first line\n  second line\nname: x\n---\n");
            let fields = parse(&raw);
            assert_eq!(
                fields[0].value, "first line, second line",
                "marker {marker}"
            );
            assert_eq!(fields[1].key, "name", "marker {marker}");
        }
    }

    #[test]
    fn handles_crlf_line_endings() {
        let raw = "---\r\nname: windows\r\ndescription: CRLF\r\n---\r\nBody\r\n";
        let meta = parse_source_meta(raw);
        assert_eq!(meta.name, "windows");
        assert_eq!(meta.description, "CRLF");
    }

    #[test]
    fn a_file_without_frontmatter_yields_nothing() {
        assert!(parse("# Just a heading\n\nSome prose.\n").is_empty());
        assert_eq!(parse_source_meta("no frontmatter"), SourceMeta::default());
    }

    #[test]
    fn keeps_what_it_can_read_from_an_unterminated_block() {
        // Exactly what a head-truncated file looks like.
        let raw = "---\nname: cut-off\ndescription: the closing fence never arrives";
        let meta = parse_source_meta(raw);
        assert_eq!(meta.name, "cut-off");
        assert_eq!(meta.description, "the closing fence never arrives");
    }

    #[test]
    fn ignores_lines_that_are_not_key_value_pairs() {
        let raw = "---\n# a comment\nname: ok\n   \nnot a pair\n---\n";
        let fields = parse(raw);
        assert_eq!(fields.len(), 1);
        assert_eq!(fields[0].key, "name");
    }

    #[test]
    fn strip_returns_the_body_after_the_block() {
        assert_eq!(strip("---\nname: x\n---\nBody here.\n"), "Body here.\n");
        assert_eq!(strip("---\r\nname: x\r\n---\r\nBody.\r\n"), "Body.\r\n");
        assert_eq!(strip("No frontmatter.\n"), "No frontmatter.\n");
    }

    #[test]
    fn head_read_does_not_split_a_multibyte_character() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("SKILL.md");

        // Place a three-byte character so that it straddles the read boundary.
        let mut content = String::from("---\nname: boundary\ndescription: ");
        while content.len() < HEAD_BYTES - 1 {
            content.push('a');
        }
        content.push('€'); // starts at HEAD_BYTES - 1, ends at HEAD_BYTES + 2
        content.push_str("\n---\n");
        std::fs::write(&path, &content).expect("write");

        let head = read_head(&path).expect("head read must not panic");
        assert!(head.len() <= HEAD_BYTES);
        assert_eq!(read_source_meta(&path).name, "boundary");
    }

    #[test]
    fn an_unreadable_file_yields_empty_metadata() {
        assert_eq!(
            read_source_meta(Path::new("/definitely/not/here/SKILL.md")),
            SourceMeta::default()
        );
    }
}
