use std::str::FromStr;

use bitcoin::{Network, Address};
use sqlx::{Sqlite, Row};

pub async fn get_all_addresses(pool: &sqlx::Pool<Sqlite>, network: Network) -> (Vec::<Address>, Vec::<Address>){
    let mut agg_addresses = Vec::<Address>::new();
    let mut backup_addresses = Vec::<Address>::new();

    let query = "SELECT backup_address FROM signer_data";

    let rows = sqlx::query(query)
        .fetch_all(pool)
        .await
        .unwrap();

    for row in rows {

        let backup_address_str = row.get::<String, _>("backup_address");
        let backup_address = Address::from_str(&backup_address_str).unwrap().require_network(network).unwrap();
        backup_addresses.push(backup_address);
    }

    let query = "SELECT p2tr_agg_address FROM statechain_data";

    let rows = sqlx::query(query)
        .fetch_all(pool)
        .await
        .unwrap();

    for row in rows {

        let p2tr_agg_address = row.get::<String, _>("p2tr_agg_address");

        if p2tr_agg_address.is_empty() {
            continue;
        }

        let agg_address = Address::from_str(&p2tr_agg_address).unwrap().require_network(network).unwrap();
        agg_addresses.push(agg_address);
    }

    (agg_addresses, backup_addresses)
}