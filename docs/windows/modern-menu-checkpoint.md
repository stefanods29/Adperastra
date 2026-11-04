# Modern Windows 11 menu: OWNER CHECKPOINT evidence

Status: **open**. The modern-menu package is not installed, not signed and
not published by Step 16.

## What exists

- `installer/modern/AppxManifest.xml`: an unsigned **design artifact** with
  `PLACEHOLDER` identity and CLSID values. It is not a usable package.
- `docs/windows/modern-menu-com-plan.md`: the `IExplorerCommand` and sparse
  package design, including the separate COM server rule.
- `windows_integration_types.rs`: `MODERN_MENU_APPROVED = false`; every apply
  request with `modern_requested` is refused with
  `windows_integration.identity_required`.
- `src/services/windowsIntegration.ts`: `MODERN_MENU_OWNER_APPROVED = false`;
  the UI never presents the modern menu as enabled while the checkpoint is
  open.

## Tradeoffs for the owner

| Route | What it needs | Why it is not chosen now |
|---|---|---|
| Signed sparse package | Code-signing certificate, trusted deployment, package identity | No certificate is installed or bundled; publishing needs the owner's explicit yes |
| Store/MSIX distribution | A store identity and account decision | Owner-only account and publication decision |
| Development-signed test package | Developer Mode, a local test certificate | Changes the owner's PC configuration and is not a distribution route |
| Classic "Show more options" only | Nothing beyond the owned registry values | Available now; truthfully labeled as the classic menu |

## Evidence required before any "enabled" claim

1. Owner-approved identity and distribution route.
2. A built, signed handler package with its CLSID and publisher recorded.
3. An installed test in a disposable Windows Sandbox with the exact package.
4. Context-menu invocation, conversion review and Cancel/Keep evidence.
5. Uninstall evidence showing the package and its registry values removed.
6. Reviewer sign-off recorded in the step report.

Until all six exist, `IntegrationStatus.modern` stays `awaiting_owner` (or
`unavailable`), and the release notes may not claim modern-menu support.

## Non-claims

- No build, installation, certificate, Developer Mode change, Sandbox run or
  publication has been performed.
- The classic menu remains the only integration verified by this step's
  coordinator-run evidence.
