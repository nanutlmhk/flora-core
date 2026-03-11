Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

repoDir = FSO.GetParentFolderName(WScript.ScriptFullName)
cmdFile = repoDir & "\start-hidro.cmd"
WshShell.CurrentDirectory = repoDir
WshShell.Run "cmd.exe /c """ & cmdFile & """", 1, False
