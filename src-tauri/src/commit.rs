//! Which commit a build came from, as the interface shows it.
//!
//! Shared with `build.rs`, which asks git and hands the answer to the compiler
//! as `SKILLS_HUB_COMMIT`. Kept free of anything but `std`, so both the build
//! script and the tests can reach it.

/// What stands in when git could not be asked — a source tarball, or a
/// machine without git.
pub const UNKNOWN: &str = "unknown";

/// Turns what git said into the label the build carries.
///
/// `sha` is the output of `git rev-parse --short HEAD`, if it ran. A tree with
/// uncommitted changes gets `-dirty`, so a local build is never mistaken for
/// the release it started from.
pub fn describe(sha: Option<&str>, dirty: bool) -> String {
    let sha = sha.map(str::trim).filter(|sha| is_hex(sha));
    match (sha, dirty) {
        (Some(sha), true) => format!("{sha}-dirty"),
        (Some(sha), false) => sha.to_owned(),
        (None, _) => UNKNOWN.to_owned(),
    }
}

fn is_hex(sha: &str) -> bool {
    sha.len() >= 7 && sha.chars().all(|c| c.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_clean_tree_is_labelled_with_its_short_sha() {
        assert_eq!(describe(Some("53580a7\n"), false), "53580a7");
    }

    #[test]
    fn uncommitted_changes_are_marked_dirty() {
        assert_eq!(describe(Some("53580a7"), true), "53580a7-dirty");
    }

    #[test]
    fn no_answer_from_git_is_unknown_whatever_the_tree() {
        assert_eq!(describe(None, false), UNKNOWN);
        assert_eq!(describe(None, true), UNKNOWN);
    }

    #[test]
    fn anything_that_is_not_a_sha_is_unknown() {
        assert_eq!(
            describe(Some("fatal: not a git repository"), false),
            UNKNOWN
        );
        assert_eq!(describe(Some(""), false), UNKNOWN);
        assert_eq!(describe(Some("abc"), false), UNKNOWN);
    }

    #[test]
    fn the_build_carries_a_label_describe_could_have_made() {
        let built = env!("SKILLS_HUB_COMMIT");
        let sha = built.strip_suffix("-dirty").unwrap_or(built);
        assert!(
            built == UNKNOWN || describe(Some(sha), built.ends_with("-dirty")) == built,
            "unexpected build label {built:?}"
        );
    }
}
