@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-hosts.ps1" %*
