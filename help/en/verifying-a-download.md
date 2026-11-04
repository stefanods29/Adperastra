# Verifying a download

Check that a downloaded file matches the project's checksum.

## How to use

Download SHA256SUMS.txt from the same release. In PowerShell, use Get-FileHash with the downloaded file and SHA256. Compare all checksum characters with its matching filename in SHA256SUMS.txt. Do not run a file when the checksums differ.

## Good to know

A checksum detects changed bytes. Check that the release page belongs to stefanods29/Adperastra on GitHub. A build attestation, when supplied, provides additional origin evidence.

See also: "Installing and updating".
