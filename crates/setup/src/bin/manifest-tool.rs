//! Development manifest tool (Step 01a): generates the dev signing key and
//! signs dependencies.json. The private key lives OUTSIDE the repository
//! (for example %USERPROFILE%\.adperastra\dev-signing.key) and is never
//! committed. Release signing replaces it in Step 08c (docs/decisions/0004).

use std::path::PathBuf;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cmd = args.first().map(|s| s.as_str()).unwrap_or("");
    match cmd {
        "keygen" => {
            let path = PathBuf::from(args.get(1).map(|s| s.as_str()).unwrap_or("dev-signing.key"));
            if path.exists() {
                eprintln!("key file already exists: {}", path.display());
                std::process::exit(1);
            }
            let (public, secret) = setup_core::generate_keypair().expect("key generation failed");
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).expect("cannot create key folder");
            }
            std::fs::write(&path, &secret).expect("cannot write key file");
            println!("private key written to: {}", path.display());
            println!("public key: {public}");
        }
        "sign" => {
            let manifest_path =
                PathBuf::from(args.get(1).expect("usage: sign <manifest> <keyfile>"));
            let key_path = PathBuf::from(args.get(2).expect("usage: sign <manifest> <keyfile>"));
            let secret = std::fs::read_to_string(&key_path).expect("cannot read key file");
            let mut manifest =
                setup_core::load_manifest(&manifest_path).expect("cannot load manifest");
            setup_core::sign_manifest(&mut manifest, &secret).expect("signing failed");
            let json = serde_json::to_string_pretty(&manifest).expect("serialize failed");
            std::fs::write(&manifest_path, json + "\n").expect("cannot write manifest");
            println!("signed: {}", manifest_path.display());
        }
        "verify" => {
            let manifest_path =
                PathBuf::from(args.get(1).expect("usage: verify <manifest> <pubkey>"));
            let manifest = setup_core::load_manifest(&manifest_path).expect("cannot load manifest");
            let status = setup_core::signature_status(
                &manifest,
                args.get(2).map(|s| s.as_str()).unwrap_or(""),
            );
            println!("signature status: {status:?}");
            if status != setup_core::SignatureStatus::Valid {
                std::process::exit(1);
            }
        }
        _ => {
            eprintln!("usage: manifest-tool keygen <keyfile> | sign <manifest> <keyfile> | verify <manifest> <pubkey>");
            std::process::exit(2);
        }
    }
}
