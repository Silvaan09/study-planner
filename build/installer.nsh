; Installer customisation, picked up by electron-builder from build/installer.nsh (see CLAUDE.md "Auto-update").
;
; "Restart & update" in the app runs the new installer visibly with --updated (src/main/updater.ts). Such an update
; shows only the progress page: it keeps the previous installation's mode instead of asking who to install for, skips
; the finish page and starts the new version by itself. Fresh installs (no --updated) keep all the usual pages.

!macro customInstallMode
  !ifndef BUILD_UNINSTALLER
    ${if} ${isUpdated}
      ${if} $hasPerMachineInstallation == "1"
      ${andIf} $hasPerUserInstallation == "0"
        StrCpy $isForceMachineInstall "1"
      ${else}
        StrCpy $isForceCurrentInstall "1"
      ${endIf}
    ${endIf}
  !endif
!macroend

!macro customFinishPage
  ; "Run Study Planner" on the finish page of a fresh install.
  Function StartApp
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" ""
  FunctionEnd

  ; An update jumps here straight from the progress page: start the new version and close the installer.
  Function skipFinishPageIfUpdated
    ${if} ${isUpdated}
      HideWindow
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "--updated"
      Abort
    ${endIf}
  FunctionEnd

  !define MUI_PAGE_CUSTOMFUNCTION_PRE skipFinishPageIfUpdated
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !insertmacro MUI_PAGE_FINISH
!macroend
