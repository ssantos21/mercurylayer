use std::str::FromStr;

use bitcoin::hashes::sha256;
use rocket::{serde::json::Json, response::status, State, http::Status};
use secp256k1_zkp::{XOnlyPublicKey, schnorr::Signature, Message, Secp256k1, PublicKey};
use serde::{Serialize, Deserialize};
use serde_json::{Value, json};
use sqlx::Row;

use crate::server::TokenServer;

#[derive(Serialize, Deserialize, JsonSchema, Debug, Clone, PartialEq)]
pub struct Invoice{
    pub id: String,
    pub pr: String,
    pub checkoutUrl: String,
    pub onChainAddr: String,
}

#[derive(Serialize, Deserialize, JsonSchema, Debug, Clone, PartialEq)]
pub struct ReqInvoice{
    pub title: String,
    pub description: String,
    pub amount: String,
    pub unit: String,
    pub redirectAfterPaid: String,
    pub email: String,
    pub emailLanguage: String,
    pub onChain: bool,
    pub delay: u64,
    pub extra: Extra,
}

#[derive(Serialize, Deserialize, JsonSchema, Debug, Clone, PartialEq)]
pub struct Extra{
    pub tag: String,
}

#[derive(Serialize, Deserialize, JsonSchema, Debug, Clone, PartialEq)]
pub struct RTLInvoice{
    pub id: String,
    pub pr: String,
    pub checkoutUrl: String,
    pub onChainAddr: String,
}

#[derive(Serialize, Deserialize, JsonSchema, Debug, Clone, PartialEq)]
pub struct RTLData{
    pub label: String,
    pub bolt11: String,
    pub payment_hash: String,
    pub msatoshi: u64,
    pub amount_msat: String,
    pub status: String,
    pub description: String,
    pub expires_at: u64
}

#[derive(Serialize, Deserialize, JsonSchema, Debug, Clone, PartialEq)]
pub struct RTLQuery{
    pub createdAt: String,
    pub delay: u64,
    pub pr: String,
    pub amount: u64,
    pub btcAmount: String,
    pub unit: String,
    pub isPaid: bool,
    pub updatePrice: bool,
    pub isHodled: bool,
    pub isInit: bool,
    pub isFixedSatPrice: bool,
    pub deleteExpiredInvoice: bool,
    pub isExpired: bool,
    pub paymentMethod: String,
    pub paidAt: String,
    pub title: String,
    pub hash: String,
    pub fiatAmount: f64,
    pub fiatUnit: String,
    pub onChainAddr: String,
    pub minConfirmations: u64,
    pub confirmations: u64,
    pub txId: String,
    pub isPending: bool,
    pub extra: Extra,
}

#[derive(Serialize, Deserialize, JsonSchema, Debug, Clone, PartialEq)]
pub struct PODInfo {
    pub token_id: String,
    pub fee: String,
    pub lightning_invoice: String,
    pub btc_payment_address: String,
    pub processor_id: String,
}

#[derive(Serialize, Deserialize, JsonSchema, Debug, Clone)]
pub struct PODStatus {
    pub confirmed: bool,
}


#[get("/token/token_init")]
pub async fn token_init(token_server: &State<TokenServer>) -> status::Custom<Json<Value>>  {

    let token_id = uuid::Uuid::new_v4().to_string();   

    let invoice: Invoice = self
        .get_lightning_invoice(&token_id)?
        .into();
    let pod_info = PODInfo {
        token_id,
        fee: token_server.config.fee.clone(),
        lightning_invoice: invoice.pr,
        btc_payment_address: invoice.onChainAddr,
        processor_id: invoice.id,
    };

    insert_new_token(&statechain_entity.pool, &token_id, &lightning_invoice, &btc_payment_address, &processor_id).await;

    let response_body = json!(pod_info);

    return status::Custom(Status::Ok, Json(response_body));
}

#[get("/token/token_verify/<token_id>")]
pub async fn token_verify(token_server: &State<TokenServer>, token_id: String) -> status::Custom<Json<Value>> {

    let row = sqlx::query(
        "SELECT processor_id, confirmed, spent \
        FROM public.tokens \
        WHERE token_id = $1")
        .bind(&token_id)
        .fetch_one(pool)
        .await;

    if row.is_err() {
        match row.err().unwrap() {
            sqlx::Error::RowNotFound => return None,
            _ => return None, // this case should be treated as unexpected error
        }
    }

    let row = row.unwrap();

    let processor_id: String = row.get(0);
    let confirmed: bool = row.get(1);
    let spent: bool = row.get(2);

    if spent {
        pod_status = PODStatus {
            confirmed: false,
        }
        let response_body = json!(pod_status);
        return status::Custom(Status::Ok, Json(response_body));            
    }

    if confirmed {
        pod_status = PODStatus {
            confirmed: true,
        }
        let response_body = json!(pod_status);
        return status::Custom(Status::Ok, Json(response_body));            
    } else {
        if self.query_lightning_payment(&token_id, &processor_id)? {
            set_token_confirmed(&statechain_entity.pool, &token_id).await;
            pod_status = PODStatus {
                confirmed: true,
            }
            let response_body = json!(pod_status);
            return status::Custom(Status::Ok, Json(response_body));  
        } else {
            pod_status = PODStatus {
                confirmed: false,
            }
            let response_body = json!(pod_status);
            return status::Custom(Status::Ok, Json(response_body));
        }
    }
}

pub async fn insert_new_token(pool: &sqlx::PgPool, token_id: &str, invoice: &str, onchain_address: &str, processor_id: &str)  {

    let query = "INSERT INTO tokens (token_id, invoice, onchain_address, processor_id, confirmed, spent) VALUES ($1, $2, $3, $4, $5, $6)";

    let _ = sqlx::query(query)
        .bind(token_id)
        .bind(invoice)
        .bind(onchain_address)
        .bind(processor_id)
        .bind(false)
        .bind(false)
        .execute(pool)
        .await
        .unwrap();
}


fn get_lightning_invoice(token_id: String) -> Result<Invoice> {

    let processor_url = token_server.config.processor_url.clone();
    let api_key = token_server.config.api_key.clone();
    let path: &str = "checkout";
    let extra: Extra = Extra {
        tag: "invoice-web".to_string(),
    };
    let inv_request: ReqInvoice = ReqInvoice {
        title: token_id.clone().to_string(),
        description: "".to_string(),
        amount: token_server.config.fee.clone(),
        unit: "BTC".to_string(),
        redirectAfterPaid: "".to_string(),
        email: "".to_string(),
        emailLanguage: "en".to_string(),
        onChain: true,
        delay: 1440,
        extra: extra,
    };

    let client: reqwest::Client = reqwest::Client::new();
    let request = client.post(&format!("{}/{}", processor_url, path));
    
    let value = match request.header("Api-Key", api_key).header("encodingtype","hex").json(&inv_request).send().await {
        Ok(response) => {
            let text = response.text().await.unwrap();
            text
        },
        Err(err) => {
            let response_body = json!({
                "error": "Internal Server Error",
                "message": err.to_string()
            });
        
            return status::Custom(Status::InternalServerError, Json(response_body));
        },
    };

    let ret_invoice: RTLInvoice = serde_json::from_str(value.as_str()).expect(&format!("failed to parse: {}", value.as_str()));

    let invoice = Invoice {
        id: ret_invoice.id,
        pr: ret_invoice.pr,
        checkoutUrl: ret_invoice.checkoutUrl,
        onChainAddr: ret_invoice.onChainAddr,
    };
    return Ok(invoice);
}

fn query_lightning_payment(processor_id: &String,) -> Result<bool> {

    let id_str = &id.to_string();

    let processor_url = token_server.config.processor_url.clone();
    let api_key = token_server.config.api_key.clone();
    let path: String = "checkout/".to_string() + processor_id;

    let client: reqwest::Client = reqwest::Client::new();
    let request = client.get(&format!("{}{}", url, path));

    let value = match request.header("Api-Key", api_key).header("encodingtype","hex").json(&inv_request).send().await {
        Ok(response) => {
            let text = response.text().await.unwrap();
            text
        },
        Err(err) => {
            let response_body = json!({
                "error": "Internal Server Error",
                "message": err.to_string()
            });
        
            return status::Custom(Status::InternalServerError, Json(response_body));
        },
    };

    let ret_invoice: RTLQuery = serde_json::from_str(value.as_str()).expect(&format!("failed to parse: {}", value.as_str()));

    let invoice_list: RTLQuery = get_cln(&cln_url, &path, &macaroon)?;
    if(invoice_list.isPaid) {
        return Ok(true)
    } else {
        return Ok(false)
    }
}

pub async fn set_token_confirmed(pool: &sqlx::PgPool, token_id: &str)  {

    let mut transaction = pool.begin().await.unwrap();

    let query = "UPDATE tokens \
        SET confirmed = true \
        WHERE token_id = $1";

    let _ = sqlx::query(query)
        .bind(token_id)
        .execute(&mut *transaction)
        .await
        .unwrap();

    transaction.commit().await.unwrap();
}
