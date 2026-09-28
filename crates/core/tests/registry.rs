//! Reading a registry's answers.
//!
//! The response comes off the network and its `source` ends up as an argument
//! to git, so what is checked here is mostly what gets rejected.

#![allow(clippy::expect_used, clippy::panic)]

use skills_core::registry;

/// Trimmed from a real answer, keeping the shape and the extra fields.
const REAL_RESPONSE: &str = r#"{
  "query": "pdf",
  "searchType": "hybrid",
  "searchVersion": 3,
  "count": 2,
  "duration_ms": 41,
  "skills": [
    { "id": "anthropics/skills/pdf", "source": "anthropics/skills", "skillId": "pdf", "name": "pdf", "installs": 201991 },
    { "id": "acme/tools/reader", "source": "acme/tools", "skillId": "reader", "name": "reader", "installs": 12 }
  ]
}"#;

#[test]
fn reads_a_real_answer() {
    let hits = registry::parse_search(REAL_RESPONSE).expect("parse");

    assert_eq!(hits.len(), 2);
    assert_eq!(hits[0].name, "pdf");
    assert_eq!(hits[0].source, "anthropics/skills");
    assert_eq!(hits[0].installs, 201_991);
    assert_eq!(hits[0].repo_url, "https://github.com/anthropics/skills");
}

/// A registry is free to add to its own response; that is not a reason to
/// stop working.
#[test]
fn ignores_fields_it_does_not_know() {
    let body = r#"{"skills":[{"id":"a/b/c","source":"a/b","name":"c","installs":1,"verified":true,"audit":{"socket":"ok"}}]}"#;
    assert_eq!(registry::parse_search(body).expect("parse").len(), 1);
}

#[test]
fn drops_one_bad_row_rather_than_the_whole_answer() {
    let body = r#"{"skills":[
        {"id":"a/b/c","source":"a/b","name":"c","installs":1},
        {"id":"broken","name":"no source"},
        {"id":"d/e/f","source":"d/e","name":"f","installs":2}
    ]}"#;
    let hits = registry::parse_search(body).expect("parse");
    assert_eq!(hits.len(), 2);
    assert_eq!(hits[1].name, "f");
}

#[test]
fn an_empty_answer_is_not_an_error() {
    assert!(
        registry::parse_search(r#"{"skills":[]}"#)
            .expect("parse")
            .is_empty()
    );
    assert!(
        registry::parse_search(r#"{"count":0}"#)
            .expect("parse")
            .is_empty()
    );
}

#[test]
fn an_answer_that_is_not_json_says_so() {
    let err = registry::parse_search("<!doctype html>").expect_err("should fail");
    assert_eq!(err.code(), "registry");
}

/// This string comes off the network and is handed to git. A `https://` URL
/// can never be read as a flag, but a row naming something GitHub could not
/// host is a row we do not understand.
#[test]
fn refuses_a_source_that_is_not_an_owner_and_a_repository() {
    for bad in [
        "",
        "justone",
        "too/many/parts",
        "../../etc",
        "owner/../repo",
        "own er/repo",
        "owner/repo;rm -rf",
        "-flag/repo",
    ] {
        assert_eq!(registry::repo_url(bad), None, "{bad:?} should be refused");
    }
}

#[test]
fn accepts_the_names_github_actually_allows() {
    for good in ["a/b", "vercel-labs/skills", "some_org/repo.js", "A1/B2"] {
        assert!(
            registry::repo_url(good).is_some(),
            "{good:?} should be allowed"
        );
    }
}

#[test]
fn a_bad_source_takes_only_its_own_row_with_it() {
    let body = r#"{"skills":[
        {"id":"x","source":"../escape","name":"bad","installs":9},
        {"id":"a/b/c","source":"a/b","name":"good","installs":1}
    ]}"#;
    let hits = registry::parse_search(body).expect("parse");
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].name, "good");
}

#[test]
fn builds_a_search_url_with_the_query_encoded() {
    assert_eq!(
        registry::search_url("pdf"),
        "https://skills.sh/api/search?q=pdf"
    );
    assert_eq!(
        registry::search_url("  sap abap  "),
        "https://skills.sh/api/search?q=sap+abap"
    );
    assert_eq!(
        registry::search_url("c#/&x"),
        "https://skills.sh/api/search?q=c%23%2F%26x"
    );
}
