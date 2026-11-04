# Verifying copies

Check copied bytes before publishing each file.

## How to use

Enable **Verify copied files** in transfer settings, then start a copy. The app reads the completed staged copy and compares its full hash with the source.

## Good to know

Verification adds disk reading time. A mismatch keeps the original and does not publish that result. Cross-drive moves always check the copy size before removing the source.

See also: "Copying and conflicts" and "The job queue".
