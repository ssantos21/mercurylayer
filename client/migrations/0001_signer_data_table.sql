CREATE TABLE IF NOT EXISTS signer_seed (
    seed BLOB NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS signer_data (
    
    token_id TEXT,

    client_seckey_share BLOB UNIQUE,
    client_pubkey_share BLOB UNIQUE,
    backup_address TEXT,   

    client_derivation_path TEXT,
    auth_derivation_path TEXT,
    change_index INT,
    address_index INT,

    auth_seckey BLOB UNIQUE,
    auth_pubkey BLOB UNIQUE,

    transfer_address TEXT,
    
    fingerprint TEXT,
    
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS statechain_data (

    statechain_id TEXT,
    signed_statechain_id TEXT,

    amount INT,
    server_pubkey_share BLOB,
    aggregated_xonly_pubkey BLOB,
    p2tr_agg_address TEXT,

    funding_txid TEXT,
    funding_vout INT,

    sent_to TEXT,

    client_pubkey_share BLOB,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS backup_transaction (

    tx_n INT,
    statechain_id TEXT,
    client_public_nonce BLOB,
    blinding_factor BLOB,
    backup_tx BLOB,
    recipient_address TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP

);