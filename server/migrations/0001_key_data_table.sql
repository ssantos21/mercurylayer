CREATE TABLE public.statechain_data (
	id serial4 NOT NULL,
	token_id varchar NULL UNIQUE,
    auth_xonly_public_key bytea NULL UNIQUE,
	server_public_key bytea NULL UNIQUE,
    statechain_id varchar NULL UNIQUE,
	CONSTRAINT statechain_data_pkey PRIMARY KEY (id),
	CONSTRAINT statechain_data_server_public_key_ukey UNIQUE (server_public_key)
);

CREATE TABLE public.statechain_transfer (
	id serial4 NOT NULL,
	statechain_id varchar UNIQUE,
	new_user_auth_public_key bytea,
	x1 bytea,
	encrypted_transfer_msg bytea NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	key_updated boolean DEFAULT false,
	batch_id varchar NULL,
	batch_time TIMESTAMPTZ NULL,
	locked boolean NOT NULL DEFAULT false,
	CONSTRAINT statechain_transfer_pkey PRIMARY KEY (id)
);

CREATE TABLE public.statechain_signature_data (
	id serial4 NOT NULL,
	server_pubnonce varchar NULL,
	challenge varchar NULL,
	tx_n integer DEFAULT 0,
	statechain_id varchar NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.tokens (
	id serial4 NOT NULL,
	token_id varchar NULL UNIQUE,
	invoice varchar NULL,
	onchain_address varchar NULL,
	processor_id varchar NULL,
	confirmed boolean DEFAULT false,
	spent boolean DEFAULT false
);