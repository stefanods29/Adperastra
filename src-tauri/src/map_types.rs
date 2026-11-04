//! Canonical photo-map DTOs (Step 11b, `map-tiles-1`).
//!
//! The map reads only indexed local photos with valid GPS metadata and shows
//! OpenStreetMap tiles fetched by the native side. No URL, host or provider
//! name ever travels from the UI: the four DTOs below are the whole contract.
#![allow(dead_code)]


use fs_service::source_stamp::{FileIdentityKey, SourceStamp};
use search_index::limits::is_safe_u64;
use search_index::types::validate_uuid;
use serde::{Deserialize, Serialize};

use crate::activity::{check_key, check_path};

pub const OSM_TILE_URL: &str = "https://tile.openstreetmap.org";
pub const OSM_ATTRIBUTION: &str = "© OpenStreetMap contributors";
pub const OSM_USER_AGENT: &str = "Adperastra";
pub const OSM_USER_AGENT_URL: &str = "https://github.com/stefanods29/Adperastra";
pub const TILE_SIZE: u32 = 256;
pub const MAX_ZOOM: u8 = 19;
pub const MAX_TILE_BYTES: u64 = 512 * 1024;
pub const MAP_CACHE_BYTES: u64 = 256 * 1024 * 1024;
/// Seven days, used when a tile response has no readable caching headers.
pub const MIN_TILE_TTL_SECONDS: u64 = 7 * 24 * 60 * 60;
pub const TILE_REQUEST_TIMEOUT_SECONDS: u64 = 10;
pub const MAX_GEO_POINTS: usize = 256;
pub const MAX_GEO_PAGE_BYTES: usize = 768 * 1024;
pub const MAX_GEO_PHOTOS_PER_SESSION: usize = 10_000;
/// Photo metadata may hold any WGS-84 latitude; projection clamps to the
/// Web Mercator limit on the UI side.
pub const MIN_GEO_LATITUDE: f64 = -90.0;
pub const MAX_GEO_LATITUDE: f64 = 90.0;
pub const MIN_GEO_LONGITUDE: f64 = -180.0;
pub const MAX_GEO_LONGITUDE: f64 = 180.0;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GeoPoint {
    pub key: FileIdentityKey,
    pub path: String,
    pub source: SourceStamp,
    pub latitude: f64,
    pub longitude: f64,
    pub date_unix: Option<u64>,
}

impl GeoPoint {
    pub fn validate(&self) -> Result<(), String> {
        check_key(&self.key)?;
        check_path(&self.path)?;
        self.source
            .validate()
            .map_err(|_| "map.invalid".to_string())?;
        if !self.latitude.is_finite()
            || !self.longitude.is_finite()
            || !(MIN_GEO_LATITUDE..=MAX_GEO_LATITUDE).contains(&self.latitude)
            || !(MIN_GEO_LONGITUDE..=MAX_GEO_LONGITUDE).contains(&self.longitude)
        {
            return Err("map.invalid".to_string());
        }
        if self.date_unix.is_some_and(|value| !is_safe_u64(value)) {
            return Err("map.invalid".to_string());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoPointPage {
    pub points: Vec<GeoPoint>,
    pub next_cursor: Option<String>,
    pub complete: bool,
    pub skipped_count: u32,
    pub generation: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MapTileLease {
    pub lease_id: String,
    pub token: String,
    pub name: String,
    pub mime: String,
    pub byte_len: u64,
    pub width: u32,
    pub height: u32,
}

impl MapTileLease {
    pub fn validate(&self) -> Result<(), String> {
        validate_uuid(&self.lease_id).map_err(|_| "map.invalid".to_string())?;
        // `FileGrants` issues 32 lower-case hex tokens (a simple UUID); the
        // adpfile protocol accepts exactly that shape.
        if !crate::files::is_valid_token(&self.token) {
            return Err("map.invalid".to_string());
        }
        if self.name != "tile.png"
            || self.mime != "image/png"
            || self.byte_len == 0
            || self.byte_len > MAX_TILE_BYTES
            || self.width != TILE_SIZE
            || self.height != TILE_SIZE
        {
            return Err("map.invalid".to_string());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct MapTileRequest {
    pub zoom: u8,
    pub x: u32,
    pub y: u32,
}

impl MapTileRequest {
    /// Only the numeric slippy-map path exists; no host, scheme or query can
    /// be supplied by the UI.
    pub fn validate(&self) -> Result<(), String> {
        if self.zoom > MAX_ZOOM {
            return Err("map.invalid".to_string());
        }
        let side = 1_u32
            .checked_shl(u32::from(self.zoom))
            .ok_or_else(|| "map.invalid".to_string())?;
        if self.x >= side || self.y >= side {
            return Err("map.invalid".to_string());
        }
        Ok(())
    }

    pub fn url_path(&self) -> String {
        format!("/{}/{}/{}.png", self.zoom, self.x, self.y)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MapTile {
    pub lease: MapTileLease,
    pub cached: bool,
    pub expires_unix: u64,
    pub attribution: String,
}

impl MapTile {
    pub fn validate(&self) -> Result<(), String> {
        self.lease.validate()?;
        if self.attribution != OSM_ATTRIBUTION || !is_safe_u64(self.expires_unix) {
            return Err("map.invalid".to_string());
        }
        Ok(())
    }
}

/// The one User-Agent every tile request sends.
pub fn user_agent(app_version: &str) -> String {
    format!("{OSM_USER_AGENT}/{app_version} ({OSM_USER_AGENT_URL})")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalidxydeny() {
        assert_eq!(
            MapTileRequest {
                zoom: 0,
                x: 1,
                y: 0
            }
            .validate(),
            Err("map.invalid".to_string())
        );
        assert_eq!(
            MapTileRequest {
                zoom: 0,
                x: 0,
                y: 1
            }
            .validate(),
            Err("map.invalid".to_string())
        );
        assert_eq!(
            MapTileRequest {
                zoom: 20,
                x: 0,
                y: 0
            }
            .validate(),
            Err("map.invalid".to_string())
        );
        assert_eq!(
            MapTileRequest {
                zoom: 19,
                x: (1 << 19) - 1,
                y: (1 << 19) - 1
            }
            .validate(),
            Ok(())
        );
        assert_eq!(
            MapTileRequest {
                zoom: 3,
                x: 7,
                y: 7
            }
            .url_path(),
            "/3/7/7.png"
        );
    }

    #[test]
    fn the_attribution_is_the_fixed_osm_string() {
        assert_eq!(OSM_ATTRIBUTION, "© OpenStreetMap contributors");
        assert_eq!(
            user_agent("0.2.2"),
            "Adperastra/0.2.2 (https://github.com/stefanods29/Adperastra)"
        );
    }
}
