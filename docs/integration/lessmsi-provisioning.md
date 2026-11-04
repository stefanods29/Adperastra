# Office extraction tool, 2026-11-03

Coordinator-only tool: lessmsi v2.12.9, MIT. Official release archive `https://github.com/activescott/lessmsi/releases/download/v2.12.9/lessmsi-v2.12.9.zip`, 740956 bytes, publisher SHA256 `5b4e187e74b184ad3a63ccf06c3d17dae2b8c4b6c298a996dbd51a9f6db29d21`. Not bundled with Adperastra or added as a runtime dependency. License: https://github.com/activescott/lessmsi/blob/v2.12.9/LICENSE .

Use `lessmsi x <verified MSI> <fresh output directory with trailing backslash>` to read/decompress the official Office files without running the MSI's installation actions, changing system policy, registering software or requiring administrator rights. This is a read-only archive extraction alternative to system installation. Never use its overwrite extraction modes. Keep extracted binaries outside Git; verify the resulting engine before considering pack activation. Upstream documentation: https://github.com/activescott/lessmsi/wiki/Command-Line .
