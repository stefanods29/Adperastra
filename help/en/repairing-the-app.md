# Repairing the app

If Adperastra will not start, or a needed component was deleted or damaged, run the setup program with the repair option:

    AdperastraSetup.exe --repair

It checks every required component against the signed list in dependencies.json, reinstalls only what is missing or broken (verifying the checksum before using it), and then starts the app. If you are offline, it says what is missing and how to get it.

Your settings, files and first-run choices are not touched by a repair.
