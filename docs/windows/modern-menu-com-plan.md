# Modern menu COM handler plan (design only)

Guide D1 requires a concrete design before the owner decides an identity
route. Nothing in this document is implemented, registered or installed.

## Mechanism

- Microsoft's supported route is a packaged app declaring
  `windows.fileExplorerContextMenus` and implementing `IExplorerCommand`.
  A sparse package can carry the identity for an unpackaged Win32 app while
  the app itself stays outside the package.
- The handler is a **separate in-process COM server** loaded by Explorer,
  never by `Adperastra.exe`. The app must not load extension DLLs into its
  own process (guide U5).
- The context-menu verb for conversion is a single fixed command. It must
  call the same user-scoped single-instance activation pipe as
  `--convert`; it never builds a command line from a file path and never
  converts without the review dialog.

## Registration pieces

1. `AppxManifest.xml` with a real identity, publisher and `uap10` trust
   level, plus the `desktop4:Extension` / `desktop5:Verb` entry.
2. `IExplorerCommand` implementation with a stable CLSID, `GetTitle`,
   `GetIcon`, `GetState` and `Invoke`. `Invoke` passes the selected item
   array to the activation pipe with the fixed conversion intent.
3. Sparse-package registration for the unpackaged executable, if the owner
   chooses that route. No registry hack promotes classic verbs into the
   modern menu.

## Open decisions (owner)

- Identity name and publisher are owner decisions; the current manifest uses
  `PLACEHOLDER` values.
- Trusted deployment requires a signed package or an accepted store route.
  The project currently has **no certificate** and no publication approval.
- The handler DLL needs its own unsigned build and security review before it
  can be considered.

## Why it is not shipped here

- Signing and trusted deployment conflict with the standing no-certificate
  distribution rule.
- Installing a development certificate or changing Developer Mode is an
  owner-only action and is explicitly out of scope for this step.
- The classic "Show more options" integration remains the only verified
  feature; the UI labels it truthfully.
