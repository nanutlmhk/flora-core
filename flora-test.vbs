Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

repoDir = FSO.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = repoDir

' Run with visible console (1) so build output is shown
WshShell.Run "powershell.exe -ExecutionPolicy Bypass -File """ & repoDir & "\scripts\start-flora.ps1""", 1, False
