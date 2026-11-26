use crate::{
    app_error::AppCommandError,
    app_state::AppState,
    commands::conversation_snooze::{self, SnoozeState, Update},
};
use axum::{extract::Extension, Json};
use std::sync::Arc;
pub async fn get_conversation_snoozes(
    Extension(state): Extension<Arc<AppState>>,
) -> Result<Json<Vec<SnoozeState>>, AppCommandError> {
    Ok(Json(conversation_snooze::load(&state.db.conn).await?))
}
pub async fn update_conversation_snooze(
    Extension(state): Extension<Arc<AppState>>,
    Json(update): Json<Update>,
) -> Result<Json<SnoozeState>, AppCommandError> {
    Ok(Json(
        conversation_snooze::save(&state.db.conn, &state.emitter, update).await?,
    ))
}
