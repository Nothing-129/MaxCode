//! Durable completion/read state shared by every client of this backend.
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
use std::collections::HashMap;

const PREFIX: &str = "conversation_read:";
pub const EVENT: &str = "conversation-read://changed";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ReadReceipt {
    pub conversation_id: i64,
    pub receipt: String,
    #[serde(default)]
    pub unread: bool,
    #[serde(default)]
    pub revision: u64,
}

fn decode(id: i64, value: String) -> ReadReceipt {
    serde_json::from_str(&value).unwrap_or(ReadReceipt {
        conversation_id: id,
        receipt: value,
        unread: false,
        revision: 0,
    })
}

pub async fn current<C: ConnectionTrait>(conn: &C, id: i64) -> Result<ReadReceipt, DbError> {
    if let Some(value) =
        app_metadata_service::get_value_conn(conn, &format!("{PREFIX}{id}")).await?
    {
        return Ok(decode(id, value));
    }
    let conv = conversation::Entity::find_by_id(id as i32)
        .one(conn)
        .await?;
    Ok(legacy_state(id, conv.as_ref()))
}

fn legacy_state(id: i64, conv: Option<&conversation::Model>) -> ReadReceipt {
    ReadReceipt {
        conversation_id: id,
        receipt: conv
            .as_ref()
            .map(|c| format!("legacy:{}", c.updated_at))
            .unwrap_or_else(|| "initial".into()),
        revision: 0,
        unread: conv.is_some_and(|c| {
            c.parent_id.is_none()
                && c.deleted_at.is_none()
                && c.lab_settled_at.unwrap_or(0) == 0
                && c.status == conversation::ConversationStatus::PendingReview
        }),
    }
}

pub async fn record_completion<C: ConnectionTrait>(conn: &C, id: i32) -> Result<(), DbError> {
    let previous = current(conn, id.into()).await?;
    let value = ReadReceipt {
        conversation_id: id.into(),
        receipt: uuid::Uuid::new_v4().to_string(),
        unread: true,
        revision: previous.revision + 1,
    };
    app_metadata_service::upsert_value(
        conn,
        &format!("{PREFIX}{id}"),
        &serde_json::to_string(&value).expect("serializable receipt"),
    )
    .await
}

pub async fn load(conn: &DatabaseConnection) -> Result<Vec<ReadReceipt>, AppCommandError> {
    let rows = app_metadata::Entity::find()
        .filter(app_metadata::Column::Key.starts_with(PREFIX))
        .all(conn)
        .await
        .map_err(DbError::from)?;
    let mut values: HashMap<i64, ReadReceipt> = rows
        .into_iter()
        .filter_map(|row| {
            let id = row.key.strip_prefix(PREFIX)?.parse().ok()?;
            Some((id, decode(id, row.value)))
        })
        .collect();
    for c in conversation::Entity::find()
        .filter(conversation::Column::ParentId.is_null())
        .filter(conversation::Column::DeletedAt.is_null())
        .all(conn)
        .await
        .map_err(DbError::from)?
    {
        values
            .entry(c.id.into())
            .or_insert_with(|| legacy_state(c.id.into(), Some(&c)));
    }
    Ok(values.into_values().collect())
}

#[cfg(test)]
pub async fn save(
    conn: &DatabaseConnection,
    emitter: &EventEmitter,
    ids: Vec<i64>,
) -> Result<Vec<ReadReceipt>, AppCommandError> {
    save_expected(conn, emitter, ids, None).await
}

pub async fn save_expected(
    conn: &DatabaseConnection,
    emitter: &EventEmitter,
    ids: Vec<i64>,
    expected: Option<HashMap<String, String>>,
) -> Result<Vec<ReadReceipt>, AppCommandError> {
    let mut saved = Vec::new();
    for id in ids
        .into_iter()
        .filter(|id| *id > 0 && *id <= i32::MAX.into())
    {
        let tx = conn.begin().await.map_err(DbError::from)?;
        let previous = current(&tx, id).await?;
        let value = if expected
            .as_ref()
            .is_some_and(|e| e.get(&id.to_string()) != Some(&previous.receipt))
        {
            previous
        } else {
            let value = ReadReceipt {
                conversation_id: id,
                receipt: uuid::Uuid::new_v4().to_string(),
                unread: false,
                revision: previous.revision + 1,
            };
            app_metadata_service::upsert_value(
                &tx,
                &format!("{PREFIX}{id}"),
                &serde_json::to_string(&value).expect("serializable receipt"),
            )
            .await?;
            value
        };
        tx.commit().await.map_err(DbError::from)?;
        emit_event(emitter, EVENT, &value);
        saved.push(value);
    }
    Ok(saved)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn completion_survives_reconnect_and_stale_reads_cannot_clear_new_turn() {
        let db = crate::db::test_helpers::fresh_in_memory_db().await;
        record_completion(&db.conn, 7).await.unwrap();
        let first = load(&db.conn).await.unwrap().pop().unwrap();
        assert!(first.unread);
        let read = save_expected(
            &db.conn,
            &EventEmitter::Noop,
            vec![7],
            Some(HashMap::from([("7".into(), first.receipt.clone())])),
        )
        .await
        .unwrap();
        assert!(!read[0].unread);
        record_completion(&db.conn, 7).await.unwrap();
        let second = current(&db.conn, 7).await.unwrap();
        assert!(second.revision > first.revision);
        let stale = save_expected(
            &db.conn,
            &EventEmitter::Noop,
            vec![7],
            Some(HashMap::from([("7".into(), first.receipt)])),
        )
        .await
        .unwrap();
        assert!(stale[0].unread);
        assert_eq!(stale[0].receipt, second.receipt);
        assert!(load(&db.conn).await.unwrap()[0].unread);
    }

    #[tokio::test]
    async fn receipts_survive_reload_and_reads_do_not_replace_other_conversations() {
        let db = crate::db::test_helpers::fresh_in_memory_db().await;
        assert!(load(&db.conn).await.unwrap().is_empty());
        let first = save(&db.conn, &EventEmitter::Noop, vec![7, 8])
            .await
            .unwrap();
        let second = save(&db.conn, &EventEmitter::Noop, vec![7, -1, 0])
            .await
            .unwrap();
        assert_eq!(second.len(), 1);
        assert_ne!(first[0].receipt, second[0].receipt);
        let loaded = load(&db.conn).await.unwrap();
        assert_eq!(loaded.len(), 2);
        assert_eq!(
            loaded
                .iter()
                .find(|r| r.conversation_id == 7)
                .unwrap()
                .receipt,
            second[0].receipt
        );
        assert_eq!(
            loaded
                .iter()
                .find(|r| r.conversation_id == 8)
                .unwrap()
                .receipt,
            first[1].receipt
        );
    }
}
