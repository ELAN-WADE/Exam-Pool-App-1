param(
    [string]$Domain = ""
)

$ErrorActionPreference = "Continue"

# If no domain passed via parameter, check .env file in project directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = (Resolve-Path "$scriptDir\..").Path
$envFile = "$projectDir\.env"

if (-not $Domain -and (Test-Path $envFile)) {
    $envLines = Get-Content $envFile
    foreach ($line in $envLines) {
        if ($line -match '^\s*CUSTOM_URL\s*=\s*(.+)$') {
            $Domain = $matches[1].Trim().Trim('"').Trim("'")
            break
        }
    }
}

# Elevate if not running as Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    $psExe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    if (-not (Test-Path $psExe)) { $psExe = "powershell.exe" }
    
    $argList = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    if ($Domain) {
        $argList += " -Domain `"$Domain`""
    }
    
    try {
        Start-Process -FilePath $psExe -Verb RunAs -ArgumentList $argList
        exit
    } catch {
        Write-Host "Please run PowerShell as Administrator to update the hosts file." -ForegroundColor Red
        Write-Host "Right-click PowerShell -> 'Run as Administrator', then run: bun run hosts:setup" -ForegroundColor Yellow
        exit 1
    }
}

$hostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"
$markerStart = "# === EXAMPOOL LOCAL DOMAIN MAP START ==="
$markerEnd = "# === EXAMPOOL LOCAL DOMAIN MAP END ==="

$domainSet = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

# Default base domain mappings
$domainSet.Add("exampool.co") | Out-Null
$domainSet.Add("www.exampool.co") | Out-Null
$domainSet.Add("exampool.ng") | Out-Null
$domainSet.Add("www.exampool.ng") | Out-Null
$domainSet.Add("exampool.local") | Out-Null
$domainSet.Add("www.exampool.local") | Out-Null

# Custom domain passed or loaded from .env
if ($Domain) {
    $clean = $Domain.Trim().ToLower() -replace "^https?://", "" -replace "/.*$", ""
    if ($clean) {
        $domainSet.Add($clean) | Out-Null
        if (-not $clean.StartsWith("www.")) {
            $domainSet.Add("www.$clean") | Out-Null
        }
        $baseName = $clean -replace "\.[a-z0-9-]+$", ""
        if ($baseName -and $baseName -ne "exampool") {
            $domainSet.Add("$baseName.local") | Out-Null
        }
    }
}

$domainList = ($domainSet -join " ")
$entry = "`n$markerStart`n127.0.0.1 $domainList`n::1 $domainList`n$markerEnd`n"

try {
    $content = Get-Content -Path $hostsPath -Raw -ErrorAction Stop
    if ($content -match [regex]::Escape($markerStart)) {
        $pattern = "(?s)" + [regex]::Escape($markerStart) + ".*?" + [regex]::Escape($markerEnd)
        $newContent = $content -replace $pattern, ($markerStart + "`n127.0.0.1 $domainList`n::1 $domainList`n" + $markerEnd)
        Set-Content -Path $hostsPath -Value $newContent -Force
    } else {
        Add-Content -Path $hostsPath -Value $entry -Force
    }
    Write-Host ""
    Write-Host "=========================================================" -ForegroundColor Green
    Write-Host "  EXAMPOOL CUSTOM DOMAIN HOSTS MAPPING SUCCESSFUL!       " -ForegroundColor Green
    Write-Host "=========================================================" -ForegroundColor Green
    Write-Host "  The following URLs now route directly to ExamPool on this PC:" -ForegroundColor Yellow
    foreach ($d in $domainSet) {
        Write-Host "   - http://${d}:8001" -ForegroundColor Cyan
    }
    Write-Host "=========================================================" -ForegroundColor Green
    Write-Host ""
} catch {
    Write-Host "Failed to update hosts file: $_" -ForegroundColor Red
}

Write-Host "Press Enter to finish..." -ForegroundColor Gray
Read-Host
