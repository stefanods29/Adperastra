# Development PC — benchmark machine (Step 00)

All speed measurements (`plan/speed.md`) are taken on this PC. Recorded
27 Oct 2026 with PowerShell `Get-CimInstance`.

| Part | Value |
|---|---|
| CPU | 13th Gen Intel Core i5-13420H (8 cores, 12 logical processors) |
| RAM | 15.7 GB |
| GPU 1 | NVIDIA GeForce RTX 4050 Laptop GPU (driver 32.0.16.1692; WMI reports 4 GB adapter RAM — verify exact VRAM before AI-pack sizing in 14c) |
| GPU 2 | Intel UHD Graphics (driver 32.0.101.6078) |
| OS | Microsoft Windows 11 Pro, version 10.0.26200, 64-bit |
| Disk | C: NTFS, 909 GB total, 180 GB free |
| Shell | Windows PowerShell 5.1 (26100.9711) |
| Toolchain | Git 2.51.0, Rust/Cargo 1.99.0, Node.js 22.19.0, npm 11.6.1, GitHub CLI 2.103.3 |

Notes:
- A Parsec Virtual Display Adapter is present, so this session may be remote.
  Display resolution/scaling could not be read (`CurrentHorizontalResolution`
  was empty); record it locally before the first screenshot-comparison run in
  Step 01b.
- Benchmark runs must note whether the NVIDIA or Intel GPU was active, since
  thumbnail/PDF/AI timings differ between them.
