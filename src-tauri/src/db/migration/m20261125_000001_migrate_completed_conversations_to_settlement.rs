use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared(
                "UPDATE conversation
                 SET lab_settled_at = MAX(1, COALESCE(
                     CAST(strftime('%s', updated_at) AS INTEGER) * 1000
                     + CAST(substr(strftime('%f', updated_at), 4, 3) AS INTEGER),
                     0))
                 WHERE status = 'completed'
                   AND kind IN ('regular', 'chat')
                   AND parent_id IS NULL
                   AND deleted_at IS NULL
                   AND lab_settled_at IS NULL",
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // Existing and subsequently recorded settlements share the same column.
        // Keep both on downgrade; the legacy conversation status is still intact.
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm_migration::sea_orm::{Database, DbBackend, Statement};

    #[tokio::test]
    async fn migrates_legacy_completions_and_keeps_existing_settlements_and_undos() {
        let conn = Database::connect("sqlite::memory:").await.unwrap();
        conn.execute_unprepared(
            "CREATE TABLE conversation (
                id INTEGER PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL,
                updated_at TEXT NOT NULL, parent_id INTEGER, deleted_at TEXT,
                lab_settled_at INTEGER
             );
             INSERT INTO conversation VALUES
                (1, 'regular', 'completed', '2026-11-24 00:00:00.123+00:00', NULL, NULL, NULL),
                (2, 'chat', 'completed', '2026-11-24 00:00:00+00:00', NULL, NULL, NULL),
                (3, 'chat', 'completed', '2026-11-24 00:00:00+00:00', NULL, NULL, 0),
                (4, 'chat', 'completed', '2026-11-24 00:00:00+00:00', NULL, NULL, 42),
                (5, 'regular', 'pending_review', '2026-11-24 00:00:00+00:00', NULL, NULL, NULL),
                (6, 'delegate', 'completed', '2026-11-24 00:00:00+00:00', 1, NULL, NULL),
                (7, 'regular', 'completed', '2026-11-24 00:00:00+00:00', NULL, '2026-11-24', NULL)",
        )
        .await
        .unwrap();
        let manager = SchemaManager::new(&conn);
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();

        let rows = conn
            .query_all(Statement::from_string(
                DbBackend::Sqlite,
                "SELECT lab_settled_at FROM conversation ORDER BY id",
            ))
            .await
            .unwrap();
        let settled_at: Vec<Option<i64>> = rows
            .iter()
            .map(|row| row.try_get("", "lab_settled_at").unwrap())
            .collect();
        assert_eq!(
            settled_at,
            vec![
                Some(1_795_478_400_123),
                Some(1_795_478_400_000),
                Some(0),
                Some(42),
                None,
                None,
                None,
            ]
        );
    }
}
