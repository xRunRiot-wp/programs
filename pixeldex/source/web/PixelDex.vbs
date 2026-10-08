' Double-click to open PixelDex (no console window, nothing installed).
Set sh = CreateObject("WScript.Shell")
here = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here
sh.Run Chr(34) & here & "\runtime\pythonw.exe" & Chr(34) & " " & Chr(34) & here & "\pixeldex.pyw" & Chr(34), 0, False
