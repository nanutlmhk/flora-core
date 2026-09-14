!macro customInit
  InitPluginsDir
  ${If} ${FileExists} "$INSTDIR\flora.db"
    CopyFiles /SILENT "$INSTDIR\flora.db" "$PLUGINSDIR\flora.db"
  ${EndIf}
!macroend

!macro customInstall
  ${If} ${FileExists} "$PLUGINSDIR\flora.db"
    CopyFiles /SILENT "$PLUGINSDIR\flora.db" "$INSTDIR\flora.db"
    DetailPrint "Preserved existing Flora database"
  ${ElseIfNot} ${FileExists} "$INSTDIR\flora.db"
    CopyFiles /SILENT "$INSTDIR\resources\seed\flora.db" "$INSTDIR\flora.db"
    DetailPrint "Installed Flora database seed"
  ${EndIf}
!macroend
