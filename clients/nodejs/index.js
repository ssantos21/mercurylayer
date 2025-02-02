const { Command } = require('commander');
const program = new Command();

const mercury_wasm = require('mercury-wasm');

const ElectrumCli = require('@mempool/electrum-client');

const deposit = require('./deposit');
const broadcast_backup_tx = require('./broadcast_backup_tx');
const withdraw = require('./withdraw');
const transfer_receive = require('./transfer_receive');
const transfer_send = require('./transfer_send');
const coin_status = require('./coin_status');

const sqlite3 = require('sqlite3').verbose();

const sqlite_manager = require('./sqlite_manager');

const { v4: uuidv4 } = require('uuid');

const wallet_manager = require('./wallet');

const config = require('config');

async function main() {

  const db = new sqlite3.Database('wallet.db');

  await sqlite_manager.createTables(db);

  const urlElectrum = config.get('electrumServer');
  const urlElectrumObject = new URL(urlElectrum);

  const electrumPort = parseInt(urlElectrumObject.port, 10);
  const electrumHostname = urlElectrumObject.hostname;  
  const electrumProtocol = urlElectrumObject.protocol.slice(0, -1);

  const electrumClient = new ElectrumCli(electrumPort, electrumHostname, electrumProtocol);
  await electrumClient.connect();
  
  program
    .name('Statechain nodejs CLI client')
    .description('CLI to test the Statechain nodejs client')
    .version('0.0.1');
  
  program.command('create-wallet')
    .description('Create a new wallet')
    .argument('<name>', 'name of the wallet')
    .action(async (name) => {

      let wallet = await wallet_manager.createWallet(name, config, electrumClient);
 
      await sqlite_manager.insertWallet(db, wallet);

      console.log(JSON.stringify(wallet, null, 2));
  
      electrumClient.close();
      db.close();
    });

    program.command('new-token')
    .description('Get new token.')
    .argument('<wallet_name>', 'name of the wallet')
    .action(async (wallet_name) => {

      const token = await deposit.getToken(db, wallet_name);
      console.log(JSON.stringify(token, null, 2));

      electrumClient.close();
      db.close();
    });

    program.command('list-tokens')
      .description("List wallet's tokens") 
      .argument('<wallet_name>', 'name of the wallet')
      .action(async (wallet_name) => {
    
        let wallet = await sqlite_manager.getWallet(db, wallet_name);

        console.log(JSON.stringify(wallet.tokens, null, 2));

        electrumClient.close();
        db.close();
    
    });

    program.command('new-deposit-address')
    .description('Get new deposit address. Used to fund a new statecoin.')
    .argument('<wallet_name>', 'name of the wallet')
    .argument('<amount>', 'amount to deposit')
    .action(async (wallet_name, amount) => {

      const address_info = await deposit.getDepositBitcoinAddress(db, wallet_name, amount);

      console.log(JSON.stringify(address_info, null, 2));

      electrumClient.close();
      db.close();
    });

    program.command('broadcast-backup-transaction')
      .description('Broadcast a backup transaction via CPFP') 
      .argument('<wallet_name>', 'name of the wallet')
      .argument('<statechain_id>', 'statechain id of the coin')
      .argument('<to_address>', 'recipient bitcoin address')
      .option('-f, --fee_rate <fee_rate>', '(optional) fee rate in satoshis per byte')
      .action(async (wallet_name, statechain_id, to_address, options) => {

       await coin_status.updateCoins(electrumClient, db, wallet_name);

       let tx_ids = await broadcast_backup_tx.execute(electrumClient, db, wallet_name, statechain_id, to_address, options.fee_rate);

       console.log(JSON.stringify(tx_ids, null, 2));

       electrumClient.close();
       db.close();
    });

    program.command('list-statecoins')
      .description("List wallet's statecoins") 
      .argument('<wallet_name>', 'name of the wallet')
      .action(async (wallet_name) => {

        await coin_status.updateCoins(electrumClient, db, wallet_name);

        let wallet = await sqlite_manager.getWallet(db, wallet_name);

        let coins = wallet.coins.map(coin => ({
          statechain_id: coin.statechain_id,
          amount: coin.amount,
          status: coin.status,
          adress: coin.address,
          locktime: coin.locktime
        }));
        
        console.log(JSON.stringify(coins, null, 2));

        electrumClient.close();
        db.close();

    });

    program.command('withdraw')
      .description('Withdraw funds from a statecoin to a BTC address') 
      .argument('<wallet_name>', 'name of the wallet')
      .argument('<statechain_id>', 'statechain id of the coin')
      .argument('<to_address>', 'recipient bitcoin address')
      .option('-f, --fee_rate <fee_rate>', '(optional) fee rate in satoshis per byte')
      .action(async (wallet_name, statechain_id, to_address, options) => {

        await coin_status.updateCoins(electrumClient, db, wallet_name);

        const txid = await withdraw.execute(electrumClient, db, wallet_name, statechain_id, to_address, options.fee_rate);

        console.log(JSON.stringify({
          txid
        }, null, 2));

        electrumClient.close();
        db.close();
      });

    program.command('new-transfer-address')
      .description('New transfer address for a statecoin') 
      .argument('<wallet_name>', 'name of the wallet')
      .option('-b, --generate-batch-id', 'optional batch id for the transaction')
      .action(async (wallet_name, options) => {

        const addr = await transfer_receive.newTransferAddress(db, wallet_name)
        let res = {transfer_receive: addr};

        if (options.generateBatchId) {
          const batchId = uuidv4();
          res.batch_id = batchId;
        }

        console.log(JSON.stringify(res, null, 2));

        electrumClient.close();
        db.close();
    });

    program.command('transfer-send')
      .description('Send the specified statecoin to an SC address') 
      .argument('<wallet_name>', 'name of the wallet')
      .argument('<statechain_id>', 'statechain id of the coin')
      .argument('<to_address>', 'recipient bitcoin address')
      .option('-b, --batch-id <batch_id>', 'optional batch id for the transaction')
      .action(async (wallet_name, statechain_id, to_address, options) => {

        let batchId = options.batchId  || null;

        await coin_status.updateCoins(electrumClient, db, wallet_name);

        let coin = await transfer_send.execute(electrumClient, db, wallet_name, statechain_id, to_address, batchId);

        console.log(JSON.stringify(coin, null, 2));

        electrumClient.close();
        db.close();
      });

    program.command('transfer-receive')
      .description('Retrieve coins from server') 
      .argument('<wallet_name>', 'name of the wallet')
      .action(async (wallet_name) => {

        await coin_status.updateCoins(electrumClient, db, wallet_name);

        let received_statechain_ids = await transfer_receive.execute(electrumClient, db, wallet_name);

        console.log(JSON.stringify(received_statechain_ids, null, 2));

        electrumClient.close();
        db.close();
    });
  
  program.parse();

}

(async () => {
  await main();
})();


