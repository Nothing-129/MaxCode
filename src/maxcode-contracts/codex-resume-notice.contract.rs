use super::*;

#[test]
fn codex_resume_notice_hides_only_the_model_switch_advisory() {
    let title = "This session was recorded with model `gpt-6-astra` but is resuming with `gpt-6.1-sol`. Consider switching back to `gpt-6-astra` as it may affect Codex performance.";
    let notice = |severity, title: &str| SessionNotice {
        severity: String::from(severity),
        title: title.into(),
        description: None,
    };
    assert!(!should_surface_session_notice(
        AgentType::Codex,
        &notice("warning", title),
    ));
    assert!(should_surface_session_notice(
        AgentType::Codex,
        &notice(
            "warning",
            "Falling back from WebSockets to HTTPS transport."
        ),
    ));
    assert!(should_surface_session_notice(
        AgentType::ClaudeCode,
        &notice("warning", title),
    ));
    assert!(should_surface_session_notice(
        AgentType::Codex,
        &notice("error", title),
    ));
}
