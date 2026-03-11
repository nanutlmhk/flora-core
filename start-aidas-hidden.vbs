Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
Set Env = WshShell.Environment("PROCESS")

repoDir = FSO.GetParentFolderName(WScript.ScriptFullName)
cmdFile = repoDir & "\start-aidas.cmd"
WshShell.CurrentDirectory = repoDir
WshShell.Run "cmd.exe /c """ & cmdFile & """", 0, False
