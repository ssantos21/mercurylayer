const sqlite_manager = require('./sqlite_manager');
const mercury_wasm = require('mercury-wasm');
const axios = require('axios').default;
const { SocksProxyAgent } = require('socks-proxy-agent');
const bitcoinjs = require("bitcoinjs-lib");
const ecc = require("tiny-secp256k1");
const utils = require('./utils');
const config = require('config');
const { CoinStatus } = require('./coin_enum');

const newTransferAddress = async (db, wallet_name) => {

    let wallet = await sqlite_manager.getWallet(db, wallet_name);

    let coin = mercury_wasm.getNewCoin(wallet);

    wallet.coins.push(coin);

    await sqlite_manager.updateWallet(db, wallet);

    return coin.address;
}

const execute = async (electrumClient, db, wallet_name) => {

    let wallet = await sqlite_manager.getWallet(db, wallet_name);

    const serverInfo = await utils.infoConfig(electrumClient);

    let received_statechain_ids = [];

    for (let coin of wallet.coins) {

        if (coin.status != CoinStatus.INITIALISED) {
            continue;
        }

        // console.log("----\nuser_pubkey", coin.user_pubkey);
        // console.log("auth_pubkey", coin.auth_pubkey);
        // console.log("statechain_id", coin.statechain_id);
        // console.log("coin.amount", coin.amount);
        // console.log("coin.status", coin.status);

        let encMessages = await get_msg_addr(coin.auth_pubkey);

        if (encMessages.length == 0) {
            continue;
        }

        const statechain_ids_added = await process_encrypted_message(electrumClient, db, coin, encMessages, wallet.network, serverInfo, wallet.activities);
        received_statechain_ids = [...received_statechain_ids, ...statechain_ids_added];
    }

    await sqlite_manager.updateWallet(db, wallet);

    return received_statechain_ids;
}

const get_msg_addr = async (auth_pubkey) => {

    const statechain_entity_url = config.get('statechainEntity');
    const path = "transfer/get_msg_addr/";
    const url = statechain_entity_url + '/' + path + auth_pubkey;

    const torProxy = config.get('torProxy');

    let socksAgent = undefined;

    if (torProxy) {
        socksAgent = { httpAgent: new SocksProxyAgent(torProxy) };
    }

    const response = await axios.get(url, socksAgent);

    return response.data.list_enc_transfer_msg;
}

const process_encrypted_message = async (electrumClient, db, coin, encMessages, network, serverInfo, activities) => {
    let clientAuthKey = coin.auth_privkey;
    let newUserPubkey = coin.user_pubkey;

    let statechain_ids_added = [];

    for (let encMessage of encMessages) {

        let transferMsg = mercury_wasm.decryptTransferMsg(encMessage, clientAuthKey);

        let tx0Outpoint = mercury_wasm.getTx0Outpoint(transferMsg.backup_transactions);

        const tx0Hex = await getTx0(electrumClient, tx0Outpoint.txid);

        const isTransferSignatureValid = mercury_wasm.verifyTransferSignature(newUserPubkey, tx0Outpoint, transferMsg);

        if (!isTransferSignatureValid) {
            console.error("Invalid transfer signature");
            continue;
        }
        
        const statechainInfo = await utils.getStatechainInfo(transferMsg.statechain_id);

        if (statechainInfo == null) {
            console.error("Statechain info not found");
            continue;
        }

        const isTx0OutputPubkeyValid = mercury_wasm.validateTx0OutputPubkey(statechainInfo.enclave_public_key, transferMsg, tx0Outpoint, tx0Hex, network);

        if (!isTx0OutputPubkeyValid) {
            console.error("Invalid tx0 output pubkey");
            continue;
        }

        let latestBackupTxPaysToUserPubkey = mercury_wasm.verifyLatestBackupTxPaysToUserPubkey(transferMsg, newUserPubkey, network);

        if (!latestBackupTxPaysToUserPubkey) {
            console.error("Latest Backup Tx does not pay to the expected public key");
            continue;
        }

        if (statechainInfo.num_sigs != transferMsg.backup_transactions.length) {
            console.error("num_sigs is not correct");
            continue;
        }
        
        let isTx0OutputUnspent = await verifyTx0OutputIsUnspentAndConfirmed(electrumClient, tx0Outpoint, tx0Hex, network);
        if (!isTx0OutputUnspent.result) {
            console.error("tx0 output is spent or not confirmed");
            continue;
        }

        const currentFeeRateSatsPerByte = serverInfo.fee_rate_sats_per_byte;

        const feeRateTolerance = config.get('feeRateTolerance');

        let previousLockTime = null;

        let sigSchemeValidation = true;

        for (const [index, backupTx] of transferMsg.backup_transactions.entries()) {

            const isSignatureValid = mercury_wasm.verifyTransactionSignature(backupTx.tx, tx0Hex, feeRateTolerance, currentFeeRateSatsPerByte);

            if (!isSignatureValid.result) {
                console.error(`Invalid signature, ${isSignatureValid.result.msg}`);
                sigSchemeValidation = false;
                break;
            }

            const currentStatechainInfo = statechainInfo.statechain_info[index];

            const isBlindedMusigSchemeValid = mercury_wasm.verifyBlindedMusigScheme(backupTx, tx0Hex, currentStatechainInfo);

            if (!isBlindedMusigSchemeValid.result) {
                console.error(`Invalid musig scheme, ${isBlindedMusigSchemeValid.result.msg}`);
                sigSchemeValidation = false;
                break;
            }

            if (previousLockTime != null) {
                let currentLockTime = mercury_wasm.getBlockheight(backupTx);
                if ((previousLockTime - currentLockTime) != serverInfo.interval) {
                    console.error("interval is not correct");
                    sigSchemeValidation = false;
                    break;
                }
            }

            previousLockTime = mercury_wasm.getBlockheight(backupTx);
        }

        if (!sigSchemeValidation) {
            console.error("Signature scheme validation failed");
            continue;
        }

        const transferReceiverRequestPayload = mercury_wasm.createTransferReceiverRequestPayload(statechainInfo, transferMsg, coin);

        let signedStatechainIdForUnlock = mercury_wasm.signMessage(transferMsg.statechain_id, coin);

        await unlockStatecoin(transferMsg.statechain_id, signedStatechainIdForUnlock, coin.auth_pubkey);

        let serverPublicKeyHex = "";

        try {
            serverPublicKeyHex = await sendTransferReceiverRequestPayload(transferReceiverRequestPayload);
        } catch (error) {
            console.error(error);
            continue;
        }

        let newKeyInfo = mercury_wasm.getNewKeyInfo(serverPublicKeyHex, coin, transferMsg.statechain_id, tx0Outpoint, tx0Hex, network);

        coin.server_pubkey = serverPublicKeyHex;
        coin.aggregated_pubkey = newKeyInfo.aggregate_pubkey;
        coin.aggregated_address = newKeyInfo.aggregate_address;
        coin.statechain_id = transferMsg.statechain_id;
        coin.signed_statechain_id = newKeyInfo.signed_statechain_id;
        coin.amount = newKeyInfo.amount;
        coin.utxo_txid = tx0Outpoint.txid;
        coin.utxo_vout = tx0Outpoint.vout;
        coin.locktime = previousLockTime;
        coin.status = isTx0OutputUnspent.status;

        let utxo = `${tx0Outpoint.txid}:${tx0Outpoint.vout}`;

        let activity = {
            utxo: utxo,
            amount: newKeyInfo.amount,
            action: "Receive",
            date: new Date().toISOString()
        };

        activities.push(activity);

        statechain_ids_added.push(transferMsg.statechain_id);

        await sqlite_manager.insertOrUpdateBackupTxs(db, transferMsg.statechain_id, transferMsg.backup_transactions);
    }

    return statechain_ids_added;
}

const getTx0 = async (electrumClient, tx0_txid) => {
    return await electrumClient.request('blockchain.transaction.get', [tx0_txid]); // request(promise)
}

const verifyTx0OutputIsUnspentAndConfirmed = async (electrumClient, tx0Outpoint, tx0Hex, wallet_network) => {

    let tx0outputAddress = mercury_wasm.getOutputAddressFromTx0(tx0Outpoint, tx0Hex, wallet_network);

    const network = utils.getNetwork(wallet_network);

    bitcoinjs.initEccLib(ecc);

    let script = bitcoinjs.address.toOutputScript(tx0outputAddress, network);
    let hash = bitcoinjs.crypto.sha256(script);
    let reversedHash = Buffer.from(hash.reverse());
    reversedHash = reversedHash.toString('hex');

    let utxo_list = await electrumClient.request('blockchain.scripthash.listunspent', [reversedHash]);

    let status = CoinStatus.UNCONFIRMED;

    for (let unspent of utxo_list) {
        if (unspent.tx_hash === tx0Outpoint.txid && unspent.tx_pos === tx0Outpoint.vout) {

            const block_header = await electrumClient.request('blockchain.headers.subscribe');
            const blockheight = block_header.height;

            const confirmations = blockheight - unspent.height + 1;

            const confirmationTarget = config.get('confirmationTarget');

            if (confirmations >= confirmationTarget) {
                status = CoinStatus.CONFIRMED;
            }
            
            return { result: true, status };
        }
    }

    return { result: false, status };
}

const unlockStatecoin = async (statechainId, signedStatechainId, authPubkey) => {

    const statechain_entity_url = config.get('statechainEntity');
    const path = "transfer/unlock";
    const url = statechain_entity_url + '/' + path;

    const torProxy = config.get('torProxy');

    let socksAgent = undefined;

    if (torProxy) {
        socksAgent = { httpAgent: new SocksProxyAgent(torProxy) };
    }

    let transferUnlockRequestPayload = {
        statechain_id: statechainId,
        auth_sig: signedStatechainId,
        auth_pub_key: authPubkey,
    };

    const response = await axios.post(url, transferUnlockRequestPayload, socksAgent);

    if (response.status != 200) {
        throw new Error(`Failed to unlock transfer message`);
    }
}

const sleep = (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const sendTransferReceiverRequestPayload = async (transferReceiverRequestPayload) => {

    const statechain_entity_url = config.get('statechainEntity');
    const path = "transfer/receiver";
    const url = statechain_entity_url + '/' + path;

    const torProxy = config.get('torProxy');

    let socksAgent = undefined;

    if (torProxy) {
        socksAgent = { httpAgent: new SocksProxyAgent(torProxy) };
    }

    while(true) {

        try {
            const response = await axios.post(url, transferReceiverRequestPayload, socksAgent);
            return response.data.server_pubkey;
        }
        catch (error) {

            if (error.response.status == 400) {
                if (error.response.data.code == 'ExpiredBatchTimeError') {
                    throw new Error(`Failed to update transfer message ${error.response.data.message}`);
                } else  if (error.response.data.code == 'StatecoinBatchLockedError') {
                    console.log("Statecoin batch still locked. Waiting until expiration or unlock.");
                    await sleep(5000);
                    continue;
                }
            } else {
                throw new Error(`Failed to update transfer message ${JSON.stringify(error.response.data)}`);
            }
        }
    }
}

module.exports = { newTransferAddress, execute };
