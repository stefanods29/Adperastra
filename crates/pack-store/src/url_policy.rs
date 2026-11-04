//! HTTPS and destination policy for signed pack URLs. Credentials,
//! fragments, local names and private addresses are refused; a test-only
//! loopback fixture can be enabled by an injected policy.

use std::net::{IpAddr, Ipv4Addr};

use reqwest::Url;

use crate::error::PackError;

/// An HTTPS origin with no path, query, credentials or fragment, normalized
/// to `https://host[:port]`.
pub fn normalize_https_origin(text: &str, allow_test_loopback: bool) -> Result<String, PackError> {
    let url = parse_https_url(text, allow_test_loopback)?;
    if url.path() != "/" && !url.path().is_empty() {
        return Err(PackError::BadRequest);
    }
    if url.query().is_some() {
        return Err(PackError::BadRequest);
    }
    let origin = url.origin().ascii_serialization();
    if origin == "null" {
        return Err(PackError::BadRequest);
    }
    Ok(origin)
}

/// Parse an HTTPS URL and refuse credentials, fragments, local names and
/// private destinations (unless a test-only loopback fixture is allowed).
pub fn parse_https_url(text: &str, allow_test_loopback: bool) -> Result<Url, PackError> {
    let url = Url::parse(text).map_err(|_| PackError::BadRequest)?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(PackError::BadRequest);
    }
    let host = url
        .host_str()
        .ok_or(PackError::BadRequest)?
        .trim_start_matches('[')
        .trim_end_matches(']');
    if host.is_empty() {
        return Err(PackError::BadRequest);
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_local_address(ip) && !(allow_test_loopback && ip.is_loopback()) {
            return Err(PackError::BadRequest);
        }
    } else {
        let lower = host.to_ascii_lowercase();
        if lower == "localhost"
            || lower.ends_with(".localhost")
            || lower.ends_with(".local")
            || lower.ends_with(".internal")
            || lower.ends_with(".home.arpa")
            || !lower.contains('.')
        {
            return Err(PackError::BadRequest);
        }
    }
    Ok(url)
}

/// True for addresses a public download must never reach.
pub fn is_local_address(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(ip) => {
            let octets = ip.octets();
            ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_unspecified()
                || ip.is_multicast()
                || ip.is_broadcast()
                || octets[0] == 0
                || (octets[0] == 100 && (64..=127).contains(&octets[1]))
                || (octets[0] == 192 && octets[1] == 0 && octets[2] == 0)
                || (octets[0] == 198 && (18..=19).contains(&octets[1]))
                || octets[0] >= 240
        }
        IpAddr::V6(ip) => {
            // IPv4-mapped and IPv4-compatible text forms must be checked as
            // the IPv4 address they carry, not as an opaque IPv6 literal.
            if let Some(mapped) = ip.to_ipv4_mapped() {
                return is_local_address(IpAddr::V4(mapped));
            }
            let segments = ip.segments();
            if segments[..6].iter().all(|segment| *segment == 0) {
                return is_local_address(IpAddr::V4(Ipv4Addr::new(
                    (segments[6] >> 8) as u8,
                    segments[6] as u8,
                    (segments[7] >> 8) as u8,
                    segments[7] as u8,
                )));
            }
            ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_multicast()
                || segments[0] & 0xfe00 == 0xfc00
                || segments[0] & 0xffc0 == 0xfe80
                || segments[0] & 0xffc0 == 0xfec0
                || (segments[0] == 0x2001 && segments[1] == 0x0db8)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::is_local_address;

    #[test]
    fn mapped_ipv4_private_addresses_are_local() {
        let mapped: std::net::IpAddr = "::ffff:10.0.0.1".parse().unwrap();
        let compatible: std::net::IpAddr = "::127.0.0.1".parse().unwrap();
        assert!(is_local_address(mapped));
        assert!(is_local_address(compatible));
    }

    #[test]
    fn mapped_ipv4_public_addresses_are_not_local() {
        let public: std::net::IpAddr = "::ffff:8.8.8.8".parse().unwrap();
        assert!(!is_local_address(public));
    }
}
