' Avvia il bot senza finestra visibile, con l'output registrato in data\bot.log
'
' Serve all'attivita' pianificata di Windows: node.exe lanciato direttamente aprirebbe una
' finestra di console a ogni accesso. Questo script la nasconde, ma non nasconde i log —
' un processo invisibile e senza traccia sarebbe impossibile da diagnosticare.
'
' Il log viene riscritto a ogni avvio: interessa la sessione corrente, non lo storico.

Option Explicit

Dim shell, fso, root, node, command

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Lo script sta in <progetto>\scripts\: due livelli sopra c'e' la radice del progetto.
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
shell.CurrentDirectory = root

' Percorso esplicito a node: l'attivita' pianificata puo' partire con un PATH ridotto.
node = "C:\Program Files\nodejs\node.exe"
If Not fso.FileExists(node) Then
  node = "node"
End If

If Not fso.FolderExists(root & "\data") Then
  fso.CreateFolder(root & "\data")
End If

command = "cmd /c """"" & node & """ dist\index.js > data\bot.log 2>&1"""

' Il secondo argomento e' lo stile finestra: 0 = nascosta. Il terzo, False, significa
' che non si attende la fine del processo.
shell.Run command, 0, False
