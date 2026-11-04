# Local provisioning, 2026-11-03

Owner authorized installing dependencies, optional engines and a small model. Requested Meta model: `muse-spark-1.3-contributor`, effort `minimal` (verified against https://dev.meta.ai/docs/reasoning). Authorization does not publish releases or change remotes.

## Completed

- `npm install --ignore-scripts --no-audit --no-fund`: added 54 packages. Production frontend build passed. Install scripts were not executed.
- Official llama.cpp b12032 CPU x64 and whisper.cpp v1.8.2 x64 archives downloaded and extracted outside Git, under `%LOCALAPPDATA%/Adperastra-provisioning/1968a251-cea1-4d45-8b43-302e8c1ff4f3`. Archive inventory includes SHA256 and publisher digest when supplied. llama-cli reports build 12032 / dde879bc4. Whisper CLI launches.
- Pinned Whisper base model SHA256 `60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe` verified. A one-second synthetic silence smoke test loaded the model and completed in 4419.50ms, emitting “you”; this proves execution, not transcription accuracy or silence handling. No microphone or personal audio used.
- LibreOffice 26.8.2 MSI downloaded to `%LOCALAPPDATA%/Adperastra-provisioning/office-26.8.2`, matching planned SHA256 `ff4b911403b67ee9e6249f820f9782c44bb32c94fdaa45b0da53a8e419e5307a`.
- FFmpeg 9.0.2 source downloaded/extracted outside Git, matching planned SHA256 `8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e`. This is source, not an installed media engine. MSYS2 build shell was absent at the checked standard path.
- User-supplied Meta credential stored separately using Windows DPAPI CurrentUser in an ACL-restricted provisioning directory, with non-secret model/effort preferences. No plaintext credential was written to project files, passed in process arguments, or printed. This pending credential is not yet connected to the app's active-profile store.

## Still required

## Follow-up implementation in this chat

- Owner resumed implementation and reported the top-bar dragging defect. The top tab strip now marks its empty surface as a native drag region; controls and tabs are not marked, and bottom/side strips are excluded. The regression test failed first and all six strip tests then passed.
- Added the native Meta Test/List adapter with exact HTTPS host, no redirects/proxies/retries, bounded request duration/body, sensitive Authorization header and stable errors. Network checks run on worker threads and decrypted key buffers use zeroizing ownership. Three focused adapter tests pass; full gate and refreshed packaged build are pending.
- A separate real account check returned HTTP 200 and confirmed `muse-spark-1.3-contributor` is available. No file or conversation content was sent; this does not prove the app's generation path.
- The requested one-time credential import may create the default profile's `assistant/provider-meta.cred` only when absent, preserving any existing key. Move only an encrypted DPAPI blob with a protected current-user ACL from app-owned staging; never overwrite an existing credential, copy plaintext or modify unrelated settings. The original encrypted provisioning copy remains available.

## Remaining engine work

- Follow-up normal per-user Office installation returned 1603. The Spanish LaunchConditions message explicitly states administrator rights are missing. This differs from the earlier automatic-review rejection of administrative extraction; no elevation/security-policy bypass was attempted. Recorded in OWNER_TODO.md; continue independent work.
- Encrypted Meta credential was successfully imported into the default profile using create-new encrypted staging, a current-user-only protected ACL and a no-replace move. Existing credentials were not overwritten.
- Startup measurement now creates fresh unique per-run test data instead of deleting session.json from a shared fixed temporary folder. Syntax check passed; speed measurements await the new package. This also corrects reuse of the same WebView profile across purportedly separate runs.

- Automatic approval review rejected the combined Office download/MSI administrative-extraction command as blocked by policy. Download/hash verification subsequently succeeded separately. Office is not installed or integrated. Owner can launch the verified MSI manually; a system installation alone does not provide the app's confined UNO bridge and signed pack.
- Pack manager has no catalog source configured in main.rs; install/resume explicitly fail closed. Production signed catalog, reviewed artifacts and helper activation remain implementation work.
- API provider and inference runtime are constructed with `None` transports. An API key/config value alone cannot activate them. No API request or key validity check was made.
- Local runtime/model activation, speech bridge, audited non-GPL/network-disabled Windows FFmpeg build, Office bridge and signed inventory remain pending. Downloaded upstream CLIs were not renamed into trusted app helpers.
- Release pack signing and exact-object replacement/Save-as integration remain unimplemented; installation cannot enable them. No private signing directory was accessed.
- Design and lag improvements have not been implemented or measured in this provisioning pass. Frontend build warns about large chunks; this is a profiling lead, not proof of the reported lag's cause.

## Verification limitation

Initial full gate failed: native app tests reported 1603 passed, 1 failed, 9 ignored. `background_policy::background_step12a_tests::pause_all_checkpoints_within100ms` observed 314.0943ms against its unchanged 100ms assertion. No test threshold was weakened, no gate success claimed, and nothing committed or published. An isolated diagnostic rerun was launched separately. Existing unfinished integration work was preserved.
