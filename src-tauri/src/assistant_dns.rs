//! Custom endpoint DNS validation (Step 17a T4).
//!
//! Resolve every address before an approved request. Only globally routable
//! unicast addresses are allowed; a mixed public/private answer fails closed.
//! The approved set is pinned into a no-proxy/no-redirect client while the
//! original hostname remains for TLS/SNI.
#![allow(dead_code)]


use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};

pub fn hostname_refused(host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    host == "localhost" || host.ends_with(".local") || host.is_empty()
}

pub fn is_public_ipv4(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    if ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_unspecified()
        || ip.is_multicast()
    {
        return false;
    }
    // Documentation ranges 192.0.2/24, 198.51.100/24, 203.0.113/24.
    if (octets[0] == 192 && octets[1] == 0 && octets[2] == 2)
        || (octets[0] == 198 && octets[1] == 51 && octets[2] == 100)
        || (octets[0] == 203 && octets[1] == 0 && octets[2] == 113)
    {
        return false;
    }
    // Carrier-grade NAT 100.64/10.
    if octets[0] == 100 && (64..=127).contains(&octets[1]) {
        return false;
    }
    // 0.0.0.0/8 "this network" and 192.88.99.0/24 6to4 relay.
    if octets[0] == 0 {
        return false;
    }
    if octets[0] == 192 && octets[1] == 88 && octets[2] == 99 {
        return false;
    }
    // 192.0.0.0/24 and 198.18.0.0/15 benchmarking/reserved.
    if octets[0] == 192 && octets[1] == 0 && octets[2] == 0 {
        return false;
    }
    if octets[0] == 198 && (octets[1] == 18 || octets[1] == 19) {
        return false;
    }
    // 240/4 reserved.
    if octets[0] >= 240 {
        return false;
    }
    true
}

pub fn is_public_ipv6(ip: Ipv6Addr) -> bool {
    let segments = ip.segments();
    if ip.is_loopback() || ip.is_unspecified() || ip.is_multicast() {
        return false;
    }
    // Unique-local fc00::/7 and link-local fe80::/10.
    if (segments[0] & 0xfe00) == 0xfc00 || (segments[0] & 0xffc0) == 0xfe80 {
        return false;
    }
    if let Some(mapped) = ip.to_ipv4() {
        return is_public_ipv4(mapped);
    }
    // 6to4 (2002::/16) embeds an IPv4 address that may be private, and
    // Teredo (2001::/32) tunnels through a relay; neither is a plain unicast.
    if segments[0] == 0x2002 || (segments[0] == 0x2001 && segments[1] == 0) {
        return false;
    }
    // Documentation 2001:db8::/32.
    if segments[0] == 0x2001 && segments[1] == 0x0db8 {
        return false;
    }
    true
}

pub fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_ipv4(v4),
        IpAddr::V6(v6) => is_public_ipv6(v6),
    }
}

/// All answers must be public; one private answer refuses the whole request.
pub fn validate_resolved(ips: &[IpAddr]) -> Result<Vec<IpAddr>, String> {
    if ips.is_empty() || ips.iter().any(|ip| !is_public_ip(*ip)) {
        return Err("assistant.endpoint_denied".to_string());
    }
    Ok(ips.to_vec())
}

/// Pin the validated addresses to port 443 for the reqwest client. The caller
/// passes the original hostname to `resolve_to_addrs`, preserving TLS/SNI.
pub fn pin_addresses(ips: &[IpAddr]) -> Result<Vec<SocketAddr>, String> {
    let validated = validate_resolved(ips)?;
    Ok(validated.into_iter().map(|ip| SocketAddr::new(ip, 443)).collect())
}

/// A DNS rebinding result that turns private is refused before the key/body
/// are sent, even if the previous answer was public.
pub fn rebinding_refused(previous: &[IpAddr], next: &[IpAddr]) -> Result<(), String> {
    validate_resolved(previous)?;
    validate_resolved(next)?;
    Ok(())
}
