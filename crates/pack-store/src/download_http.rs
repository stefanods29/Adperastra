//! Production HTTP download client. Redirects are followed only inside the
//! signed HTTPS origin set; every URL is rechecked before each request.

use crate::download::{DownloadBody, DownloadClient};
use crate::download_state::RemoteMeta;
use crate::error::PackError;

/// Production HTTP client with a signed-origin redirect policy.
pub struct HttpDownloadClient {
    client: reqwest::blocking::Client,
    origins: Vec<String>,
    allow_test_loopback: bool,
}

impl HttpDownloadClient {
    pub fn new(allowed_origins: &[String], allow_test_loopback: bool) -> Result<Self, PackError> {
        let mut origins = Vec::with_capacity(allowed_origins.len());
        for origin in allowed_origins {
            origins.push(crate::url_policy::normalize_https_origin(
                origin,
                allow_test_loopback,
            )?);
        }
        let redirect_origins = origins.clone();
        let redirect = reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= 5 {
                return attempt.stop();
            }
            let target = attempt.url().origin().ascii_serialization();
            if redirect_origins.iter().any(|origin| origin == &target) {
                attempt.follow()
            } else {
                attempt.stop()
            }
        });
        let client = reqwest::blocking::Client::builder()
            .redirect(redirect)
            .connect_timeout(std::time::Duration::from_secs(10))
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .map_err(|_| PackError::Unavailable)?;
        Ok(Self {
            client,
            origins,
            allow_test_loopback,
        })
    }

    fn check_url(&self, url: &str) -> Result<(), PackError> {
        let parsed = crate::url_policy::parse_https_url(url, self.allow_test_loopback)?;
        let origin = parsed.origin().ascii_serialization();
        if self.origins.iter().any(|allowed| allowed == &origin) {
            Ok(())
        } else {
            Err(PackError::BadRequest)
        }
    }
}

impl DownloadClient for HttpDownloadClient {
    fn meta(&self, url: &str) -> Result<RemoteMeta, PackError> {
        self.check_url(url)?;
        let response = self
            .client
            .head(url)
            .send()
            .map_err(|_| PackError::Unavailable)?;
        if !response.status().is_success() {
            return Err(PackError::Unavailable);
        }
        let etag = header_text(&response, reqwest::header::ETAG);
        Ok(RemoteMeta::new(etag, response.content_length()))
    }

    fn get(&self, url: &str, range: Option<(u64, String)>) -> Result<DownloadBody, PackError> {
        self.check_url(url)?;
        let mut request = self.client.get(url);
        if let Some((start, etag)) = range {
            request = request
                .header(reqwest::header::RANGE, format!("bytes={start}-"))
                .header(reqwest::header::IF_RANGE, etag);
        }
        let response = request.send().map_err(|_| PackError::Unavailable)?;
        let status = response.status().as_u16();
        if !response.status().is_success() {
            return Err(PackError::Unavailable);
        }
        let content_range = header_text(&response, reqwest::header::CONTENT_RANGE);
        let etag = header_text(&response, reqwest::header::ETAG);
        Ok(DownloadBody {
            reader: Box::new(response),
            status,
            content_range_start: content_range.as_deref().and_then(parse_content_range_start),
            etag,
            total_bytes: content_range.as_deref().and_then(parse_content_range_total),
        })
    }
}

fn header_text(
    response: &reqwest::blocking::Response,
    name: reqwest::header::HeaderName,
) -> Option<String> {
    response
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.trim().to_string())
}

fn parse_content_range_start(value: &str) -> Option<u64> {
    let rest = value.strip_prefix("bytes ")?;
    let (range, _) = rest.split_once('/')?;
    let (start, _) = range.split_once('-')?;
    start.trim().parse().ok()
}

fn parse_content_range_total(value: &str) -> Option<u64> {
    let (_, total) = value.rsplit_once('/')?;
    total.trim().parse().ok()
}
