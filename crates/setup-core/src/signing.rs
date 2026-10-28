//! Manifest signing with minisign (Ed25519, prehashed signatures).
//!
//! String formats (minisign 0.8):
//! - Public key: single-line base64 from `PublicKey::to_base64`
//!   (e.g. `RW...`, 56 chars). A full minisign public-key box
//!   (comment line + base64 line) is also accepted on input.
//! - Secret key: the multi-line unencrypted secret-key box from
//!   `SecretKey::to_box(None)` (`untrusted comment: ...` line plus a
//!   base64 line), parsed with `SecretKey::from_unencrypted_box`.
//! - Signature: the multi-line signature box from
//!   `SignatureBox::to_string` (untrusted comment, signature,
//!   trusted comment, global signature), parsed with
//!   `SignatureBox::from_string`.

use crate::manifest::{Manifest, Signature};
use crate::{Result, SetupError};
use std::io::Cursor;

/// Development public key (base64, `PublicKey::to_base64` format).
/// The main session fills this in after key generation; empty means
/// no key is pinned yet and every manifest reports `Missing`.
pub const DEVELOPMENT_PUBLIC_KEY: &str = "RWQ7PAFi7vjiH8xlY9hiOp3x69dWA2PwyqXgza8C45h2qD6gAgohb/tt";

#[derive(Debug, PartialEq, Eq)]
pub enum SignatureStatus {
    Valid,
    Missing,
    Invalid,
}

fn sig_err(e: minisign::PError) -> SetupError {
    SetupError::Manifest(format!("signature: {e}"))
}

/// Canonical bytes that are signed/verified: a clone of `m` whose
/// signature is present with algorithm `minisign` and an empty value
/// (the existing public key is preserved), serialized as JSON.
pub fn canonical_manifest_bytes(m: &Manifest) -> Vec<u8> {
    let mut clone = m.clone();
    let public_key = clone
        .signature
        .as_ref()
        .map(|s| s.public_key.clone())
        .unwrap_or_default();
    clone.signature = Some(Signature {
        algorithm: "minisign".to_string(),
        public_key,
        value: String::new(),
    });
    serde_json::to_vec(&clone).expect("manifest serialization cannot fail")
}

fn parse_public_key(s: &str) -> std::result::Result<minisign::PublicKey, minisign::PError> {
    let trimmed = s.trim();
    if trimmed.contains('\n') {
        let pk_box = minisign::PublicKeyBox::from_string(trimmed)?;
        pk_box.into_public_key()
    } else {
        minisign::PublicKey::from_base64(trimmed)
    }
}

fn parse_secret_key(s: &str) -> std::result::Result<minisign::SecretKey, minisign::PError> {
    let sk_box = minisign::SecretKeyBox::from_string(s.trim())?;
    sk_box.into_unencrypted_secret_key()
}

pub fn signature_status(m: &Manifest, public_key_b64: &str) -> SignatureStatus {
    if public_key_b64.trim().is_empty() {
        return SignatureStatus::Missing;
    }
    let sig = match &m.signature {
        None => return SignatureStatus::Missing,
        Some(sig) => sig,
    };
    if sig.value.trim().is_empty() {
        return SignatureStatus::Missing;
    }
    let pk = match parse_public_key(public_key_b64) {
        Ok(pk) => pk,
        Err(_) => return SignatureStatus::Invalid,
    };
    let signature_box = match minisign::SignatureBox::from_string(sig.value.trim()) {
        Ok(b) => b,
        Err(_) => return SignatureStatus::Invalid,
    };
    let data = canonical_manifest_bytes(m);
    match minisign::verify(&pk, &signature_box, Cursor::new(data), true, false, false) {
        Ok(()) => SignatureStatus::Valid,
        Err(_) => SignatureStatus::Invalid,
    }
}

/// Generates an unencrypted keypair.
/// Returns `(public_key_string, secret_key_string)`: the public key as
/// single-line base64 (`PublicKey::to_base64`) and the secret key as
/// the multi-line unencrypted secret-key box string.
pub fn generate_keypair() -> Result<(String, String)> {
    let kp = minisign::KeyPair::generate_unencrypted_keypair().map_err(sig_err)?;
    let public_key_string = kp.pk.to_base64();
    let secret_key_string = kp.sk.to_box(None).map_err(sig_err)?.into_string();
    Ok((public_key_string, secret_key_string))
}

/// Signs `canonical_manifest_bytes(m)` (computed with an empty
/// signature value) and stores the resulting signature box string in
/// `m.signature`, together with the matching public key (base64).
pub fn sign_manifest(m: &mut Manifest, secret_key_string: &str) -> Result<()> {
    let sk = parse_secret_key(secret_key_string).map_err(sig_err)?;
    let pk = minisign::PublicKey::from_secret_key(&sk).map_err(sig_err)?;
    let public_key_string = pk.to_base64();
    m.signature = Some(Signature {
        algorithm: "minisign".to_string(),
        public_key: public_key_string.clone(),
        value: String::new(),
    });
    let data = canonical_manifest_bytes(m);
    let signature_box =
        minisign::sign(Some(&pk), &sk, Cursor::new(data), None, None).map_err(sig_err)?;
    m.signature = Some(Signature {
        algorithm: "minisign".to_string(),
        public_key: public_key_string,
        value: signature_box.to_string().trim_end().to_string(),
    });
    Ok(())
}
