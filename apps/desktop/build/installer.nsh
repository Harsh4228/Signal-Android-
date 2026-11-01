;; Right-click a file in Explorer -> Send to -> CellMate: CellMate opens and asks which chats to send it to.
!macro customInstall
  CreateShortCut "$SENDTO\CellMate.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--share" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
!macroend

!macro customUnInstall
  Delete "$SENDTO\CellMate.lnk"
!macroend
