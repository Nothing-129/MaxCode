//! Permissions belong to conversations, just like model and thinking choices.
use super::*;
use crate::acp::types::{SessionConfigBooleanInfo, SessionConfigSelectInfo};
use crate::db::service::conversation_service;
use crate::db::test_helpers::{fresh_disk_db, fresh_in_memory_db, seed_conversation, seed_folder};

fn option(id: &str, category: &str, value: &str) -> SessionConfigOptionInfo {
    SessionConfigOptionInfo {
        id: id.into(),
        name: id.into(),
        description: None,
        category: Some(category.into()),
        recommended_value: None,
        kind: SessionConfigKindInfo::Select(SessionConfigSelectInfo {
            current_value: value.into(),
            options: vec![],
            groups: vec![],
        }),
    }
}

async fn ready_state(db: &DatabaseConnection, id: i32, mode: &str, approve: bool) {
    let mut state = SessionState::new("test".into(), AgentType::Codex, None, "web".into(), None);
    state.model_config_conversation_id = Some(id);
    state.config_options = Some(vec![
        option("model", "model", "test-model"),
        option("mode", "mode", mode),
        option("sandbox", "other", mode),
        SessionConfigOptionInfo {
            kind: SessionConfigKindInfo::Boolean(SessionConfigBooleanInfo {
                current_value: approve,
            }),
            ..option("auto_approve", "permission", "")
        },
    ]);
    let state = Arc::new(RwLock::new(state));
    persist_state(db, &state).await.unwrap();
    let row = conversation::Entity::find_by_id(id)
        .one(db)
        .await
        .unwrap()
        .unwrap();
    assert!(
        row.model_config.is_none(),
        "unconfirmed permissions must not be saved"
    );
    state.write().await.selectors_ready = true;
    persist_state(db, &state).await.unwrap();
}

#[tokio::test]
async fn permissions_survive_database_reopen_without_borrowing_another_conversation() {
    let dir = tempfile::tempdir().unwrap();
    let db = fresh_disk_db(dir.path()).await;
    let folder = seed_folder(&db, "/tmp/permission-memory").await;
    let first = seed_conversation(&db, folder, AgentType::Codex).await;
    let second = seed_conversation(&db, folder, AgentType::Codex).await;
    let before = conversation_service::get_by_id(&db.conn, first)
        .await
        .unwrap()
        .updated_at;
    ready_state(&db.conn, first, "read-only", false).await;
    ready_state(&db.conn, second, "agent-full-access", true).await;
    db.conn.close().await.unwrap();
    let reopened = sea_orm::Database::connect(format!(
        "sqlite:{}?mode=rw",
        dir.path().join("source.db").display()
    ))
    .await
    .unwrap();
    for (id, mode, approve) in [
        (first, "read-only", "false"),
        (second, "agent-full-access", "true"),
    ] {
        let (_, restored) = preferences_for_connect(
            &reopened,
            AgentType::Codex,
            Some(id),
            None,
            BTreeMap::from([
                ("mode".into(), "another-chat".into()),
                ("auto_approve".into(), "another-chat".into()),
            ]),
        )
        .await
        .unwrap();
        assert_eq!(restored["mode"], mode);
        assert_eq!(restored["sandbox"], mode);
        assert_eq!(restored["auto_approve"], approve);
    }
    assert_eq!(
        conversation_service::get_by_id(&reopened, first)
            .await
            .unwrap()
            .updated_at,
        before
    );
}

#[tokio::test]
async fn legacy_histories_keep_native_permissions_while_new_chats_use_recent_defaults() {
    let db = fresh_in_memory_db().await;
    let folder = seed_folder(&db, "/tmp/legacy-permissions").await;
    let id = seed_conversation(&db, folder, AgentType::Codex).await;
    let defaults = BTreeMap::from([
        ("mode".into(), "agent-full-access".into()),
        ("approval_policy".into(), "never".into()),
        ("sandbox".into(), "danger-full-access".into()),
        ("auto_approve".into(), "true".into()),
        ("unrelated-option".into(), "keep".into()),
    ]);
    let (_, restored) =
        preferences_for_connect(&db.conn, AgentType::Codex, Some(id), None, defaults.clone())
            .await
            .unwrap();
    assert_eq!(
        restored,
        BTreeMap::from([("unrelated-option".into(), "keep".into())])
    );
    let (_, new_chat) =
        preferences_for_connect(&db.conn, AgentType::Codex, None, None, defaults.clone())
            .await
            .unwrap();
    assert_eq!(new_chat, defaults);
}

#[tokio::test]
async fn agents_with_only_session_modes_save_confirmed_mode_changes() {
    let db = fresh_in_memory_db().await;
    let folder = seed_folder(&db, "/tmp/session-mode-memory").await;
    let id = seed_conversation(&db, folder, AgentType::ClaudeCode).await;
    let mut state = SessionState::new(
        "test".into(),
        AgentType::ClaudeCode,
        None,
        "web".into(),
        None,
    );
    state.conversation_id = Some(id);
    state.selectors_ready = true;
    state.current_mode = Some("default".into());
    let state = Arc::new(RwLock::new(state));
    for mode in ["default", "bypassPermissions"] {
        state.write().await.current_mode = Some(mode.into());
        persist_state(&db.conn, &state).await.unwrap();
        let (_, restored) = preferences_for_connect(
            &db.conn,
            AgentType::ClaudeCode,
            Some(id),
            None,
            BTreeMap::new(),
        )
        .await
        .unwrap();
        assert_eq!(
            restored.get("$session_mode").map(String::as_str),
            Some(mode)
        );
    }
}

#[test]
fn restoring_standard_modes_never_uses_other_conversations_default_or_leaks_metadata() {
    let mut values = BTreeMap::from([
        ("$session_mode".into(), "default".into()),
        ("model".into(), "test-model".into()),
    ]);
    assert_eq!(
        take_mode_for_connect(true, Some("bypassPermissions".into()), &mut values).as_deref(),
        Some("default")
    );
    assert!(!values.contains_key("$session_mode"));
    assert_eq!(values["model"], "test-model");
    assert_eq!(
        take_mode_for_connect(true, Some("bypassPermissions".into()), &mut values),
        None
    );
    assert_eq!(
        take_mode_for_connect(false, Some("bypassPermissions".into()), &mut values).as_deref(),
        Some("bypassPermissions")
    );
}

#[test]
fn maintained_agents_save_select_and_boolean_permissions_by_id_or_category() {
    for agent in [
        AgentType::ClaudeCode,
        AgentType::Codex,
        AgentType::Grok,
        AgentType::Pi,
        AgentType::DeepSeek,
        AgentType::Antigravity,
        AgentType::Zcode,
    ] {
        let values = model_config_values(
            agent,
            &[
                option("permission-mode", "other", "ask"),
                option("custom-permissions", "permission", "ask"),
                SessionConfigOptionInfo {
                    kind: SessionConfigKindInfo::Boolean(SessionConfigBooleanInfo {
                        current_value: false,
                    }),
                    ..option("custom-approval", "permission", "")
                },
                option("unrelated-option", "other", "ignored"),
            ],
        );
        assert_eq!(values["permission-mode"], "ask");
        assert_eq!(values["custom-permissions"], "ask");
        assert_eq!(values["custom-approval"], "false");
        assert!(!values.contains_key("unrelated-option"));
    }
}
