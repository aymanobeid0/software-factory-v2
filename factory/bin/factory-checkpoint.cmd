@echo off
rem The factory referee for cmd/PowerShell (Codex on Windows). Locates the factory from its own path.
node "%~dp0..\checkpoint.mjs" %*
