# ADR 0001: Tauri 2 + Rust + TypeScript

Status: proposed (Step 00, awaiting owner approval).

## Context

Need fast, memory-safe core for untrusted files, web-editor reuse, Windows 11 first, cross-platform later, MIT only.

## Decision

Confirm Tauri 2 (MIT/Apache-2.0), Rust core services, TypeScript UI in system webview; heavy work never in TS.

## Alternatives rejected

WinUI3 (Windows-only, C#), Electron (size/RAM), Avalonia (webview cost without ecosystem), Qt (LGPL shell + C++ safety).

## Consequences

Per-webview capabilities + isolation pattern; Windows APIs behind Rust traits; see ARCHITECTURE.md s.1-2.
