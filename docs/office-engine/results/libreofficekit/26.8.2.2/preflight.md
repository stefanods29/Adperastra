# LibreOfficeKit 26.8.2.2 Windows preflight

2026-11-04. Windows bootstrap, isolation canaries and basic DOCX export. T4 comparison and engine selection remain pending.

- The Windows x64 MSI SHA-256 is `ff4b911403b67ee9e6249f820f9782c44bb32c94fdaa45b0da53a8e419e5307a`. The upstream commit is `9dea406ab7695df6325b11b0e19fdca8db4b7276`. The extracted `mergedlo.dll` SHA-256 is `eac63accb28228f11777bf40396dc0efb9400e6dc26dabec0cc234752552229c`. It exports `libreofficekit_hook` and `libreofficekit_hook_2`.
- A standalone x64 MSVC 17.14.41 C++17 `/MT` probe used the pinned upstream `LibreOfficeKitInit.h`, called `lok_init_2` with the extracted program directory and a fresh private profile URL, then attempted `getVersionInfo`. A Rust wrapper reused the 12b AppContainer and job launcher with a 2 GiB cap and a 25-second timeout. This bootstrap test had no document inputs and used no installed app pack or lease.
- Windows originally returned `ERROR_ENVVAR_NOT_FOUND` (203) at `CreateProcessW`. Including `LOCALAPPDATA` let the helper start in the AppContainer. DLL loading initially failed. Adding the extracted program directory to the probe's DLL search path loaded the engine. LibreOffice then exited with code 77 and reported that user installation could not be completed. A shorter private profile path and locating the helper beside the DLL both reproduced that failure. The last probe SHA-256 was `3089e33abdcfa52477b2ea6004562ee0104ec2c003b53452d72405a1ca146d0a`.
- Separate desktop command-line rendering produced single-page PDFs from a disposable DOCX and PPTX. This establishes basic read-only conversion outside Adperastra. It does not establish LibreOfficeKit startup, Windows isolation canaries, editing, preservation or pack readiness.
- A separate helper running through the same AppContainer copied a bundled preset into its private scratch directory and was denied access to a disposable ungranted file (`ERROR_ACCESS_DENIED`, 5). This is a filesystem canary, with network isolation and full engine confinement tests still pending.
- The parent reached a disposable IPv4 loopback listener before spawning the network canary. The same helper could not connect from the AppContainer (`WSAETIMEDOUT`, 10060). This is loopback evidence only.
- A diagnostic using the pinned LibreOffice filesystem API found the engine root inaccessible (`osl_File_E_ACCES`, 13) while its `presets` directory was readable. This matches the base-installation lookup that precedes profile creation. Granting read access within the MSI's dedicated extraction root made both the engine root and the presets accessible. Production pack permissions require separate verification.
- With that extraction-root grant and a private Windows desktop accessible to the AppContainer SID, `lok_init_2` returned successfully and reported product version `26.8.2.2` and the pinned build ID. The probe did not exit during its 25-second deadline and the job was terminated. A second probe opened a staged disposable DOCX and initialized a view. Its paste command returned false before save.
- A third probe posted Writer's `.uno:InsertText` and saved a new DOCX. The callback timed out, and inspection showed the edit marker absent from the saved copy. The process closed cleanly after closing the document first. Source and staged input SHA-256 remained `07df8acf29c0a291a1195bd02a8be4ca30d8f7c459e53c8781c1e86a6baaa8c7`. The output SHA-256 was `affa5f071074e64d9b16de540116573b4ea2323db1ea937acf3197890daf354f`. Both ZIP integrity checks passed. Export omitted `docProps/custom.xml`, `word/footnotes.xml`, `word/endnotes.xml`, `word/numbering.xml` and three relationship parts from this synthetic input. The fixture was too simple to infer which omissions would discard user content.
- A subsequent probe loaded a private working copy with `Batch=true,MacroSecurityLevel=3`. It verified the view was writable, dispatched `postKeyEvent` key input and key up for each ASCII character, rendered a 320 × 320 tile before and after, and saved a new copy. The marker appeared in `word/document.xml`. The tiles differed in 2,149 byte positions, and the input and working-copy hashes remained equal to the source hash above. The edited output SHA-256 was `a6cd56f072716ed3232733cbdb9df4c5d3e2653502ad26397e4205e0c673f6d3`. This demonstrates a real body-text edit on the test fixture. Command mapping, Undo/Redo, concurrency and existing-file preservation remain pending.
- A fixture with a real custom XML payload (`customXml/item850.xml`), its `rId850` document relationship and a nonempty custom document property also opened, edited and exported. The input and working copy both kept SHA-256 `f815894561b59c45d707eb3efc81f2dd0b6d674545fb673c68142fde37437403`. The exported copy (`ad9fac59632c0a87ce1539d3b9836a41bc9ce5b19b9f8a23b763f8ec0e33065d`) contained the body edit and custom document property, but the custom XML payload and relationship were absent. Both archives passed ZIP integrity checks. This is a confirmed Word preservation failure for the tested save path.

## Remaining evidence

Collabora's published Windows desktop application and Online integration SDK establish separate capabilities. A supported local embedding route for a third-party Windows application remains unverified. ZetaOffice publishes a Windows desktop beta and browser UNO integration. Local WebView2 loading, distribution and isolation remain unverified. Native LibreOfficeKit initialized and exported a Word copy in the isolated Windows probe. Editing and the production pack layout remain unverified.

No candidate has completed the required corpus comparison, five cold and warm runs, render diffs, memory measurements, command mapping, full security checks or license inventory. No recommendation for enabling existing-file editing is ready. Word, spreadsheets and presentations remain behind the Step 20a engine gate.

Calc with a synthetic two-sheet XLSX and Impress with a synthetic one-slide PPTX both started LibreOfficeKit, then did not finish opening within the 60-second process deadline. The helper jobs were terminated and produced no edited output. These runs overlapped a release compile. The results establish the timeouts for these probes, with controlled timing and independent diagnosis still pending.

Sequential retries outside the application and without a concurrent release
build reproduced the failure. Calc reached engine initialization but did not
finish opening the two-sheet XLSX within 40 seconds. Impress reached engine
initialization but did not finish opening the three-slide formatted PPTX
within 60 seconds. Neither reached the edit or save operation. This rules out
concurrent release compilation as a necessary condition for the timeouts.

Writer successfully reopened the disposable DOCX with conventional relationship
namespace serialization, inserted the body marker and saved a separate copy.
The original and working copy retained SHA-256
`f815894561b59c45d707eb3efc81f2dd0b6d674545fb673c68142fde37437403`.
The edited copy (`562fd7c119356fcc57be7764e419776c163a62877fee4965c3df86da8e91d5f6`)
passed ZIP integrity checks and contained the marker, which was absent from
the input. The isolated native conversion worker reopened the edited copy and
rendered a 30,533-byte PDF in 1,168 ms. The original custom XML part and
relationship were again missing from the edited copy. Successful reopening
does not qualify this save path for existing Word files.

After the owner reported a shutdown, the Calc and Impress probes were rerun
after boot, sequentially, with the default Windows graphics configuration
instead of explicitly requesting the headless backend. Both initialized the
engine and then reached the 25-second document-open deadline. Neither
produced a saved copy. The same failure was therefore observed in completed
probe runs on both sides of the restart.

- [LibreOfficeKit API](https://docs.libreoffice.org/libreofficekit.html)
- [Pinned LibreOfficeKit initialization header](https://github.com/LibreOffice/core/blob/9dea406ab7695df6325b11b0e19fdca8db4b7276/include/LibreOfficeKit/LibreOfficeKitInit.h)
- [Collabora Office Windows desktop release](https://www.collaboraonline.com/blog/collabora-office-26-04-release/)
- [Collabora Online integration SDK](https://sdk.collaboraonline.com/CO-SDK-manual.pdf)
- [ZetaOffice desktop and integration documentation](https://zetaoffice.net/)
