//! Prepare one offline Office pack for an isolated development build.
use pack_store::{
    catalog::{CatalogStore, CatalogTrust},
    install::{activate_verified, verify_staging},
    inventory::hash_file,
    types::{PackCatalog, PackDescriptor, PackFile, PackId},
    validation::{validate_relative_path, CatalogPolicy},
};
use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::{self, Cursor, Write},
    path::{Path, PathBuf},
};

const INVENTORY: &str = "578a3b54cbfb4b383188ac42e9377e0561e22ce87aaef4cbe53d73128db3de35";
const WORKER: &str = "bin/libreoffice-kit.exe";
const OFFLINE_ORIGIN: &str = "https://offline.adperastra.invalid";

fn provision(
    source: &Path,
    fonts: &Path,
    portable: &Path,
) -> Result<String, Box<dyn std::error::Error>> {
    let inventory = source.join("prebuilds.json");
    let inventory_bytes = fs::read(&inventory)?;
    if pack_store::validation::sha256_hex(&inventory_bytes) != INVENTORY {
        return Err("unexpected LibreOfficeKit inventory".into());
    }
    #[derive(serde::Deserialize)]
    struct Inventory {
        files: BTreeMap<String, String>,
    }
    let inventory: Inventory = serde_json::from_slice(&inventory_bytes)?;
    #[derive(serde::Deserialize)]
    struct FontInventory {
        files: Vec<FontFile>,
    }
    #[derive(serde::Deserialize)]
    struct FontFile {
        path: String,
        sha256: String,
    }
    let font_inventory: FontInventory = serde_json::from_str(include_str!(
        "../../../../docs/office-engine/results/libreofficekit/0.1.3/font-inventory.json"
    ))?;
    let mut inputs = BTreeMap::new();
    for (name, hash) in inventory.files {
        validate_relative_path(&name)?;
        inputs.insert(name.clone(), (source.join(&name), hash));
    }
    for font in font_inventory.files {
        validate_relative_path(&font.path)?;
        if font.path.contains('/') || !font.path.ends_with(".ttf") {
            return Err("invalid font inventory name".into());
        }
        if inputs
            .insert(
                format!("fonts/{}", font.path),
                (fonts.join(&font.path), font.sha256),
            )
            .is_some()
        {
            return Err("duplicate font in inventory".into());
        }
    }
    fs::create_dir(portable)?;
    let root = portable.join("AdperastraData").join("packs");
    let staging = root.join("staging").join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&staging)?;
    let archive_path = portable.join("office-0.1.3.zip");
    let mut archive = zip::ZipWriter::new(
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&archive_path)?,
    );
    let mut files = Vec::with_capacity(inputs.len());
    for (name, (source, sha256)) in inputs {
        let target = staging.join(&name);
        fs::create_dir_all(target.parent().ok_or("missing parent")?)?;
        let mut input = File::open(source)?;
        let mut staged = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)?;
        let size = io::copy(&mut input, &mut staged)?;
        staged.sync_all()?;
        drop(staged);
        if hash_file(&target)? != sha256 {
            return Err(format!("inventory mismatch: {name}").into());
        }
        archive.start_file(&name, zip::write::SimpleFileOptions::default())?;
        io::copy(&mut File::open(&target)?, &mut archive)?;
        files.push(PackFile {
            executable: name == WORKER,
            path: name,
            size,
            sha256,
        });
    }
    archive.finish()?.sync_all()?;
    let descriptor = PackDescriptor {
        id: PackId::Office,
        version: "0.1.3".into(),
        name_key: "packs.office.name".into(),
        description_key: "packs.office.desc".into(),
        // The schema requires an HTTPS address. This build only uses its
        // offline artifact and has no configured download source.
        download_url: format!("{OFFLINE_ORIGIN}/office-0.1.3.zip"),
        download_bytes: fs::metadata(&archive_path)?.len(),
        install_bytes: files.iter().map(|file| file.size).sum(),
        sha256: hash_file(&archive_path)?,
        licenses: vec![
            "MPL-2.0".into(),
            "MIT".into(),
            "OFL-1.1".into(),
            "Apache-2.0".into(),
        ],
        source_urls: vec!["https://github.com/deepseek-ai/dsh-libreoffice-kit".into()],
        files,
        dependencies: vec![],
        enables: vec!["office.convert".into()],
        entrypoints: BTreeMap::from([("office.convert".into(), WORKER.into())]),
        catalog_revision: 1,
    };
    let catalog = PackCatalog {
        schema_version: 1,
        revision: 1,
        allowed_origins: vec![OFFLINE_ORIGIN.into()],
        packs: vec![descriptor],
    };
    let bytes = serde_json::to_vec(&catalog)?;
    let (public, signature) = {
        let key = minisign::KeyPair::generate_unencrypted_keypair()?;
        let signature = minisign::sign(Some(&key.pk), &key.sk, Cursor::new(&bytes), None, None)?;
        (key.pk.to_base64(), signature)
    };
    let store = CatalogStore::new(&root);
    let trust = CatalogTrust::new(&public);
    let policy = CatalogPolicy::production();
    store.store(&bytes, &signature.to_string(), &trust, policy)?;
    let verified = store.load(&trust, policy)?;
    let descriptor = verified
        .descriptor(PackId::Office, "0.1.3")
        .ok_or("missing signed descriptor")?;
    let staged = verify_staging(&staging, descriptor)?;
    activate_verified(
        staged,
        descriptor,
        &root,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_secs(),
        &|directory, descriptor| {
            pack_store::validation::validate_capability(descriptor, "office.convert")
                .map_err(|error| error.to_string())?;
            pack_store::inventory::verify_tree(directory, descriptor)
                .map_err(|error| error.to_string())
        },
    )?;
    let mut marker = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(portable.join("portable-mode.marker"))?;
    marker.write_all(br#"{"enabled":true,"version":1}"#)?;
    marker.sync_all()?;
    Ok(public)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args_os().skip(1).map(PathBuf::from).collect();
    let [source, fonts, portable] = args.as_slice() else {
        return Err(
            "usage: local-office-pack <pinned package directory> <verified font directory> <new portable directory>".into(),
        );
    };
    println!("{}", provision(source, fonts, portable)?);
    Ok(())
}
