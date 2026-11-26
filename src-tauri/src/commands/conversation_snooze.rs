//! Shared snooze state. A cleared value is retained so an old device cannot reimport it.
use crate::app_error::AppCommandError;
use crate::db::{
    entities::{app_metadata, conversation},
    error::DbError,
    service::app_metadata_service,
};
use crate::web::event_bridge::{emit_event, EventEmitter};
use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseConnection, EntityTrait, QueryFilter, TransactionTrait,
};
use serde::{Deserialize, Serialize};

const PREFIX: &str = "conversation_snooze:";
pub const EVENT: &str = "conversation-snooze://changed";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnoozeTime {
    until: i64,
    since: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    previous_edge: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum WakeMark {
    #[serde(rename = "woken")]
    Woken,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum SnoozeMark {
    Time(SnoozeTime),
    Wake(WakeMark),
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SnoozeState {
    pub conversation_id: i32,
    pub mark: Option<SnoozeMark>,
    pub revision: u64,
}
#[derive(Deserialize)]
pub struct Update {
    pub conversation_id: i32,
    pub mark: Option<SnoozeMark>,
    pub expected_revision: Option<u64>,
    #[serde(default)]
    pub legacy: bool,
}
async fn current<C: ConnectionTrait>(conn: &C, id: i32) -> Result<Option<SnoozeState>, DbError> {
    app_metadata_service::get_value_conn(conn, &format!("{PREFIX}{id}"))
        .await?
        .map(|value| serde_json::from_str(&value).map_err(|e| DbError::Migration(e.to_string())))
        .transpose()
}
pub async fn load(conn: &DatabaseConnection) -> Result<Vec<SnoozeState>, AppCommandError> {
    let rows = app_metadata::Entity::find()
        .filter(app_metadata::Column::Key.starts_with(PREFIX))
        .filter(app_metadata::Column::DeletedAt.is_null())
        .all(conn)
        .await
        .map_err(DbError::from)?;
    rows.into_iter()
        .map(|row| {
            serde_json::from_str(&row.value).map_err(|e| DbError::Migration(e.to_string()).into())
        })
        .collect()
}
pub async fn save(
    conn: &DatabaseConnection,
    emitter: &EventEmitter,
    update: Update,
) -> Result<SnoozeState, AppCommandError> {
    if let Some(SnoozeMark::Time(time)) = &update.mark {
        if time.until <= 0 || time.since < 0 || time.until > 8_640_000_000_000_000 {
            return Err(DbError::Migration("Invalid snooze timestamp".into()).into());
        }
    }
    let tx = conn.begin().await.map_err(DbError::from)?;
    let c = conversation::Entity::find_by_id(update.conversation_id)
        .one(&tx)
        .await
        .map_err(DbError::from)?
        .filter(|c| c.deleted_at.is_none() && c.parent_id.is_none())
        .ok_or_else(|| DbError::Migration("Conversation not found".into()))?;
    let previous = current(&tx, c.id).await?;
    let revision = previous.as_ref().map_or(0, |state| state.revision);
    let unchanged = (update.legacy && previous.is_some())
        || update
            .expected_revision
            .is_some_and(|expected| expected != revision);
    let state = if unchanged {
        previous.unwrap_or(SnoozeState {
            conversation_id: c.id,
            mark: None,
            revision,
        })
    } else {
        // A stale device must not resurrect a snooze on a settled conversation.
        let mark = if c.lab_settled_at.unwrap_or(0) > 0 {
            None
        } else {
            update.mark
        };
        let state = SnoozeState {
            conversation_id: c.id,
            mark,
            revision: revision + 1,
        };
        app_metadata_service::upsert_value(
            &tx,
            &format!("{PREFIX}{}", c.id),
            &serde_json::to_string(&state).expect("serializable snooze"),
        )
        .await?;
        state
    };
    tx.commit().await.map_err(DbError::from)?;
    emit_event(emitter, EVENT, &state);
    Ok(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn snooze_survives_reload_and_stale_device_cannot_revive_cleared_state() {
        let db = crate::db::test_helpers::fresh_in_memory_db().await;
        let folder = crate::db::test_helpers::seed_folder(&db, "/tmp/shared-snooze").await;
        let c = crate::db::service::conversation_service::create(
            &db.conn,
            folder,
            crate::models::AgentType::Codex,
            None,
            None,
        )
        .await
        .unwrap();
        let mark = Some(SnoozeMark::Time(SnoozeTime {
            until: 10000,
            since: 1,
            previous_edge: Some("old-run".into()),
        }));
        let first = save(
            &db.conn,
            &EventEmitter::Noop,
            Update {
                conversation_id: c.id,
                mark: mark.clone(),
                expected_revision: None,
                legacy: false,
            },
        )
        .await
        .unwrap();
        assert_eq!(load(&db.conn).await.unwrap()[0].mark, mark);
        let newer = save(
            &db.conn,
            &EventEmitter::Noop,
            Update {
                conversation_id: c.id,
                mark: Some(SnoozeMark::Wake(WakeMark::Woken)),
                expected_revision: None,
                legacy: false,
            },
        )
        .await
        .unwrap();
        let stale = save(
            &db.conn,
            &EventEmitter::Noop,
            Update {
                conversation_id: c.id,
                mark: None,
                expected_revision: Some(first.revision),
                legacy: false,
            },
        )
        .await
        .unwrap();
        assert_eq!(stale.mark, newer.mark);
        save(
            &db.conn,
            &EventEmitter::Noop,
            Update {
                conversation_id: c.id,
                mark: None,
                expected_revision: None,
                legacy: false,
            },
        )
        .await
        .unwrap();
        let imported = save(
            &db.conn,
            &EventEmitter::Noop,
            Update {
                conversation_id: c.id,
                mark,
                expected_revision: None,
                legacy: true,
            },
        )
        .await
        .unwrap();
        assert!(imported.mark.is_none());
        assert!(load(&db.conn).await.unwrap()[0].mark.is_none());
    }
}
