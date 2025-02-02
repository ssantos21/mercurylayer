rm -rf out-kotlin/ ../target/release/ && rm ../clients/kotlin/build/classes/kotlin/main/libmercurylib.so
cargo build --features "bindings" --release
cargo run --features "bindings" --bin uniffi-bindgen generate --library ../target/release/libmercurylib.so --language kotlin --out-dir out-kotlin
cp --verbose ../target/release/libmercurylib.so ../clients/kotlin/build/classes/kotlin/main/
./modify_sh/modify_all.sh
cp --verbose out-kotlin/com/mercurylayer/mercurylib.kt ../clients/kotlin/src/main/kotlin