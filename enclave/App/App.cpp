#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wnon-virtual-dtor"
#pragma GCC diagnostic ignored "-Wcast-qual"
#pragma GCC diagnostic ignored "-Wfloat-equal"
#pragma GCC diagnostic ignored "-Wshadow"
#pragma GCC diagnostic ignored "-Wconversion"
#include <lib/crow_all.h>
#include <lib/toml.hpp>
#pragma GCC diagnostic pop

#include <algorithm>
#include <iomanip>
#include <iostream>
#include <pqxx/pqxx>
#include <stdio.h>
#include <string.h>
#include <sstream>
#include <sys/random.h> // for testing secp256k1-zkp. Can be removed after this.

#include "../utils/include_secp256k1_zkp_lib.h"
#include "../utils/strencodings.h"
#include "utilities/utilities.h"
#include "database/db_manager.h"
#include "sealing_key_manager/sealing_key_manager.h"

#include "endpoints/deposit.h"
#include "endpoints/secret.h"
#include "endpoints/sign.h"
#include "endpoints/transfer_receiver.h"

#include "App.h"
#include "Enclave_u.h"
#include "sgx_urts.h"
#include "sgx_tcrypto.h"

# define ENCLAVE_FILENAME "enclave.signed.so"

/* ocall functions (untrusted) */
void ocall_print_string(const char *str)
{
    printf("%s\n", str);
}

void ocall_print_int(const char *str, const int *number)
{
    printf("%s%d\n", str, *number);
}

void ocall_print_hex(const unsigned char** key, const int *keylen)
{
    printf("%s\n", key_to_string(*key, *keylen).c_str());
}

// TODO: duplicated. Remove this.
std::string getDatabaseConnectionString() {
    const char* value = std::getenv("ENCLAVE_DATABASE_URL");

    if (value == nullptr) {
        auto config = toml::parse_file("Settings.toml");
        return config["intel_sgx"]["database_connection_string"].as_string()->get();
    } else {
        return std::string(value);        
    }
}

int SGX_CDECL main(int argc, char *argv[])
{
    crow::SimpleApp app;

    sgx_enclave_id_t enclave_id = 0;
    std::mutex mutex_enclave_id; // protects map_aggregate_key_data

    {
        const std::lock_guard<std::mutex> lock(mutex_enclave_id);

        // initialize enclave
        sgx_status_t enclave_created = sgx_create_enclave(ENCLAVE_FILENAME, SGX_DEBUG_FLAG, NULL, NULL, &enclave_id, NULL);
        if (enclave_created != SGX_SUCCESS) {
            printf("Enclave init error\n");
            return -1;
        }
    }

    sealing_key_manager::SealingKeyManager sealing_key_manager;
    if (sealing_key_manager.readSeedFromFile()) {
        std::cout << "Seed loaded" << std::endl;
    } else {
        std::cout << "Seed not loaded" << std::endl;
    }

    if (argc > 1 && (
        std::strcmp(argv[1], "--generate-new-secret") == 0 || 
        std::strcmp(argv[1], "-g") == 0 )) 
    {
        const std::lock_guard<std::mutex> lock(mutex_enclave_id);
        
        try {
            if (sealing_key_manager.addSecret(enclave_id)) {
                std::cout << "New secret sucessfully generated." << std::endl;
            } else {
                std::cout << "Seed already exists. A new secret won't be generated." << std::endl;
            }
        } catch (const std::runtime_error& e) {
            std::cerr << "Error: " << e.what() << std::endl;
            return 1;
        }
    }

    CROW_ROUTE(app, "/get_public_key")
        .methods("POST"_method)([&enclave_id, &mutex_enclave_id, &sealing_key_manager](const crow::request& req) {
            return endpoinDeposit::handleGetPublicKey(req, enclave_id, mutex_enclave_id, sealing_key_manager);
    });

    CROW_ROUTE(app, "/get_public_nonce")
        .methods("POST"_method)([&enclave_id, &mutex_enclave_id, &sealing_key_manager](const crow::request& req) {
            return endpointSignature::handleGetPublicNonce(req, enclave_id, mutex_enclave_id, sealing_key_manager);            
    });
    
    CROW_ROUTE(app, "/get_partial_signature")
        .methods("POST"_method)([&enclave_id, &mutex_enclave_id, &sealing_key_manager](const crow::request& req) {
            return endpointSignature::handleGetPartialSignature(req, enclave_id, mutex_enclave_id, sealing_key_manager);
    });

    CROW_ROUTE(app,"/signature_count/<string>")
    ([](std::string statechain_id){
        return endpointSignature::signatureCount(statechain_id);
    });

    CROW_ROUTE(app, "/keyupdate")
        .methods("POST"_method)([&enclave_id, &mutex_enclave_id, &sealing_key_manager](const crow::request& req) {
            return endpointTransferReceiver::handleKeyUpdate(req, enclave_id, mutex_enclave_id, sealing_key_manager);
    });

    CROW_ROUTE(app,"/delete_statechain/<string>")
        .methods("DELETE"_method)([](std::string statechain_id){

        auto database_connection_string = getDatabaseConnectionString();

        std::string error_message;
        pqxx::connection conn(database_connection_string);
        if (conn.is_open()) {

            std::string delete_comm =
                "DELETE FROM generated_public_key WHERE statechain_id = $1;";
            pqxx::work txn2(conn);

            txn2.exec_params(delete_comm, statechain_id);
            txn2.commit();

            conn.close();

            crow::json::wvalue result({{"message", "Statechain deleted."}});
            return crow::response{result};
        } else {
            return crow::response(500, "Failed to connect to the database!");
        }
    });



    CROW_ROUTE(app, "/add_mnemonic")
        .methods("POST"_method)([&enclave_id, &mutex_enclave_id, &sealing_key_manager](const crow::request& req) {
            return endpointSecret::handleAddMnemonic(req, enclave_id, mutex_enclave_id, sealing_key_manager);
    });
    
    app.port(18080).multithreaded().run();

    {
        const std::lock_guard<std::mutex> lock(mutex_enclave_id);
    
        // destroy the enclave
        sgx_destroy_enclave(enclave_id);
    }

    return 0;
}
