//! License validation, moved out of app.js (where the only valid key was
//! the literal hardcoded string "SPEUSIS-LIFETIME-2026-DEMO", readable by
//! anyone via view-source, and "registered" status was just a localStorage
//! flag anyone could set from devtools with zero validation at all).
//!
//! Be clear about what this actually buys you: keys are now checksummed
//! against name+email using a salted hash, checked inside the compiled
//! Rust binary instead of plaintext JS, and device-locked plans are tied
//! to a per-install device id file. That raises the bar from "readable in
//! view-source" and "one localStorage.setItem() call" to "requires
//! reverse-engineering a compiled binary." It does NOT make this
//! uncrackable - no local, offline license check ever is, without a
//! server-side activation call. Don't market it as uncrackable.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;
use uuid::Uuid;

// Change this if you ever want to invalidate every key generated so far
// (e.g. after a leak) - every previously-issued key stops validating.
const KEY_SALT: &str = "speusis-license-v1-9f3a1c";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LicensePlan {
    Trial,
    Monthly,
    Lifetime,
}

impl LicensePlan {
    fn code(self) -> &'static str {
        match self {
            LicensePlan::Trial => "TRIAL",
            LicensePlan::Monthly => "MTH",
            LicensePlan::Lifetime => "LIFE",
        }
    }

    fn from_code(code: &str) -> Option<Self> {
        match code {
            "TRIAL" => Some(LicensePlan::Trial),
            "MTH" => Some(LicensePlan::Monthly),
            "LIFE" => Some(LicensePlan::Lifetime),
            _ => None,
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            LicensePlan::Trial => "Trial",
            LicensePlan::Monthly => "Monthly",
            LicensePlan::Lifetime => "Lifetime",
        }
    }

    /// Monthly/Trial keys are tied to the device that activated them;
    /// Lifetime isn't (matches the "buy once, use on your machines" model
    /// most lifetime-license apps use - only add a device cap here if you
    /// actually want single-machine lifetime keys too).
    pub fn is_device_locked(self) -> bool {
        matches!(self, LicensePlan::Monthly | LicensePlan::Trial)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseRecord {
    pub name: String,
    pub email: String,
    pub key: String,
    pub plan: LicensePlan,
    pub device_locked: bool,
    pub activated_at: i64,
}

fn checksum(name: &str, email: &str, plan_code: &str, payload: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(format!(
        "{}|{}|{}|{}|{}",
        name.trim().to_lowercase(),
        email.trim().to_lowercase(),
        plan_code,
        payload,
        KEY_SALT
    ));
    hex::encode(hasher.finalize())[..8].to_uppercase()
}

/// Key format: SPEUSIS-<PLAN>-<PAYLOAD>-<CHECKSUM>, e.g. SPEUSIS-LIFE-A1B2-9F21C3D0.
/// The checksum ties the key to the exact name+email given, so a key
/// generated for one buyer won't validate for someone who just changes the
/// name/email fields with a copy-pasted key.
pub fn validate_key(name: &str, email: &str, key: &str) -> Result<(LicensePlan, String), String> {
    let name = name.trim();
    let email = email.trim();
    if name.is_empty() || email.is_empty() {
        return Err("Name and email are required.".to_string());
    }
    let key = key.trim().to_uppercase();
    let parts: Vec<&str> = key.split('-').collect();
    if parts.len() != 4 || parts[0] != "SPEUSIS" {
        return Err("Invalid license key format.".to_string());
    }
    let plan = LicensePlan::from_code(parts[1]).ok_or_else(|| "Unrecognized license plan.".to_string())?;
    let payload = parts[2];
    let expected = checksum(name, email, parts[1], payload);
    if expected != parts[3] {
        return Err("This license key doesn't match the name/email provided.".to_string());
    }
    Ok((plan, key))
}

/// Run this yourself (see speusis-core/examples/genkey.rs) to issue real keys
/// to buyers - this is a developer-side tool, not something the app calls.
pub fn generate_key(name: &str, email: &str, plan: LicensePlan) -> String {
    let mut seed_hasher = Sha256::new();
    seed_hasher.update(format!("{}{}{}", name.trim().to_lowercase(), email.trim().to_lowercase(), plan.code()));
    let digest = seed_hasher.finalize();
    let payload = hex::encode(&digest[..2]).to_uppercase();
    let plan_code = plan.code();
    let sum = checksum(name, email, plan_code, &payload);
    format!("SPEUSIS-{plan_code}-{payload}-{sum}")
}

/// Per-install device id, generated once and persisted in the app data dir.
/// Copying a device-locked license record to another install won't carry
/// this file along, so it fails the device-match check there.
pub fn get_or_create_device_id(app_data_dir: &Path) -> anyhow::Result<String> {
    let path = app_data_dir.join("device.id");
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let trimmed = existing.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }
    std::fs::create_dir_all(app_data_dir)?;
    let id = Uuid::new_v4().to_string();
    std::fs::write(&path, &id)?;
    Ok(id)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredLicense {
    record: LicenseRecord,
    device_id: Option<String>,
}

fn license_path(app_data_dir: &Path) -> std::path::PathBuf {
    app_data_dir.join("license.json")
}

/// Validates the key, and for device-locked plans binds it to this
/// install's device id, then persists the activation.
pub fn activate(app_data_dir: &Path, name: &str, email: &str, key: &str) -> Result<LicenseRecord, String> {
    let (plan, normalized_key) = validate_key(name, email, key)?;
    let device_locked = plan.is_device_locked();
    let device_id = if device_locked {
        Some(get_or_create_device_id(app_data_dir).map_err(|e| e.to_string())?)
    } else {
        None
    };
    let record = LicenseRecord {
        name: name.trim().to_string(),
        email: email.trim().to_string(),
        key: normalized_key,
        plan,
        device_locked,
        activated_at: chrono::Utc::now().timestamp_millis(),
    };
    let stored = StoredLicense { record: record.clone(), device_id };
    std::fs::create_dir_all(app_data_dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(&stored).map_err(|e| e.to_string())?;
    std::fs::write(license_path(app_data_dir), json).map_err(|e| e.to_string())?;
    Ok(record)
}

/// Reads the persisted activation, if any, and for device-locked plans
/// re-verifies the current device id still matches the one it was
/// activated with. Returns None (not an error) for "no license" or "no
/// longer valid on this device" - both just mean "show the activation
/// form," same as before.
pub fn get_status(app_data_dir: &Path) -> Option<LicenseRecord> {
    let raw = std::fs::read_to_string(license_path(app_data_dir)).ok()?;
    let stored: StoredLicense = serde_json::from_str(&raw).ok()?;
    if stored.record.device_locked {
        let current_device = get_or_create_device_id(app_data_dir).ok()?;
        if stored.device_id.as_deref() != Some(current_device.as_str()) {
            return None;
        }
    }
    Some(stored.record)
}
