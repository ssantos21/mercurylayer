use chrono::{DateTime, Utc};

use sqlx::Row;

pub async fn get_batch_id_and_time_by_statechain_id(pool: &sqlx::PgPool, statechain_id: &str) -> Option<(String, DateTime<Utc>)> {

    let query = "\
        SELECT batch_id, batch_time \
        FROM statechain_transfer \
        WHERE statechain_id = $1
        AND batch_id is not null
        AND batch_time is not null";

    let row = sqlx::query(query)
        .bind(statechain_id)
        .fetch_optional(pool)
        .await
        .unwrap();

    match row {
        Some(row) => {
            let batch_id: String = row.get(0);
            let batch_time: DateTime<Utc> = row.get(1);
            Some((batch_id, batch_time))
        }
        None => None
    }
}