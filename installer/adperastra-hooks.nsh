; Adperastra NSIS installer hooks (Step 08d T2).
;
; Wired from src-tauri/tauri.conf.json:
;   bundle.windows.nsis.installMode = "currentUser"
;   bundle.windows.nsis.installerHooks = "../installer/adperastra-hooks.nsh"
;   bundle.windows.nsis.languages = ["English", "Spanish"]
;
; Rules:
; - Per-user install under %LOCALAPPDATA%\Programs\Adperastra; no admin.
; - Data stays in %LOCALAPPDATA%\Adperastra, separate from the binaries.
; - An upgrade keeps Adperastra.exe.previous and restores it if the new
;   binary is missing, too small or has the wrong version.
; - Uninstall keeps settings and data unless Remove is chosen twice; the
;   app helper validates the exact folder and recycles it without following
;   junctions. No RMDir /r is ever used on a data folder.

!define ADPERASTRA_RECYCLE_FLAG "--recycle-app-data"

LangString AdpRemoveQuestion ${LANG_ENGLISH} "Keep my settings and data?$\r$\n$\r$\nYes: Remove my settings and data (settings, cached data, packs and version history).$\r$\nNo: Keep my settings and data (recommended)."
LangString AdpRemoveQuestion ${LANG_SPANISH} "¿Conservar mi configuración y mis datos?$\r$\n$\r$\nSí: Quitar mi configuración y mis datos (configuración, caché, paquetes e historial de versiones).$\r$\nNo: Conservar mi configuración y mis datos (recomendado)."
LangString AdpRemoveConfirm ${LANG_ENGLISH} "This removes settings, cached data, packs and version history. Keep a backup before continuing."
LangString AdpRemoveConfirm ${LANG_SPANISH} "Esto quita la configuración, la caché, los paquetes y el historial de versiones. Guarda una copia antes de continuar."
LangString AdpRemoveFailed ${LANG_ENGLISH} "Settings and data were not removed. You can remove %LOCALAPPDATA%\Adperastra later."
LangString AdpRemoveFailed ${LANG_SPANISH} "No se quitaron la configuración ni los datos. Puedes quitar %LOCALAPPDATA%\Adperastra más tarde."
LangString AdpUpgradeFailed ${LANG_ENGLISH} "The new version could not be installed. Your previous app and all data are unchanged."
LangString AdpUpgradeFailed ${LANG_SPANISH} "No se pudo instalar la nueva versión. La aplicación anterior y todos los datos no cambiaron."
LangString AdpBackupFailed ${LANG_ENGLISH} "Setup could not protect the installed app, so nothing was changed."
LangString AdpBackupFailed ${LANG_SPANISH} "El instalador no pudo proteger la aplicación instalada, así que no se cambió nada."

!macro NSIS_HOOK_PREINSTALL
  ; D2: per-user path, separate from the data folder.
  StrCpy $INSTDIR "$LOCALAPPDATA\Programs\Adperastra"
  CreateDirectory "$LOCALAPPDATA\Programs"
  CreateDirectory "$INSTDIR"

  ; Keep the old binary before the new one is written.
  IfFileExists "$INSTDIR\Adperastra.exe" 0 adp_no_old_binary
    Delete "$INSTDIR\Adperastra.exe.previous"
    CopyFiles /SILENT "$INSTDIR\Adperastra.exe" "$INSTDIR\Adperastra.exe.previous"
    IfFileExists "$INSTDIR\Adperastra.exe.previous" adp_backup_ok
      MessageBox MB_OK|MB_ICONSTOP "$(AdpBackupFailed)"
      Abort
  adp_backup_ok:
  adp_no_old_binary:
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Accept the new binary only when it is present, not tiny, and reports
  ; the version this installer was built for. Otherwise restore the backup.
  IfFileExists "$INSTDIR\Adperastra.exe" 0 adp_restore_binary
  FileOpen $0 "$INSTDIR\Adperastra.exe" r
  FileSeek $0 0 END $1
  FileClose $0
  IntCmpU $1 1048576 adp_restore_binary adp_restore_binary adp_check_version
  adp_check_version:
  GetFileVersion "$INSTDIR\Adperastra.exe" $0
  StrCmp $0 "${VERSION}" adp_upgrade_ok
  StrCmp $0 "${VERSION}.0" adp_upgrade_ok
  Goto adp_restore_binary
  adp_restore_binary:
    IfFileExists "$INSTDIR\Adperastra.exe.previous" 0 adp_no_backup
      Delete "$INSTDIR\Adperastra.exe"
      Rename "$INSTDIR\Adperastra.exe.previous" "$INSTDIR\Adperastra.exe"
    adp_no_backup:
      MessageBox MB_OK|MB_ICONSTOP "$(AdpUpgradeFailed)"
      SetErrorLevel 1
      Abort
  adp_upgrade_ok:
    Delete "$INSTDIR\Adperastra.exe.previous"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  MessageBox MB_YESNO|MB_DEFBUTTON2|MB_ICONQUESTION "$(AdpRemoveQuestion)" IDNO adp_keep_data IDYES adp_confirm_remove
  adp_confirm_remove:
    MessageBox MB_YESNO|MB_DEFBUTTON2|MB_ICONEXCLAMATION "$(AdpRemoveConfirm)" IDNO adp_keep_data IDYES adp_remove_data
  adp_remove_data:
    IfFileExists "$INSTDIR\Adperastra.exe" 0 adp_remove_failed
      ExecWait '"$INSTDIR\Adperastra.exe" ${ADPERASTRA_RECYCLE_FLAG} "$LOCALAPPDATA\Adperastra" remove' $0
      StrCmp $0 "0" adp_keep_data
    adp_remove_failed:
      MessageBox MB_OK|MB_ICONEXCLAMATION "$(AdpRemoveFailed)"
  adp_keep_data:
  ; Keep is the default and does nothing here. The data folder is never
  ; passed to RMDir or Remove-Item.
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; The binaries are removed by the standard uninstaller. Settings and data
  ; stay unless the helper above moved the exact folder to the Recycle Bin.
!macroend
