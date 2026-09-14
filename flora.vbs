Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

repoDir = FSO.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = repoDir

WshShell.Run "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & repoDir & "\scripts\launch-flora.ps1""", 0, False
