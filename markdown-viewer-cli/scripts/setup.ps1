# markdown-viewer-cli Setup Script (Windows)
# Detects skill location automatically and installs dependencies

$ErrorActionPreference = "Stop"

# Determine script directory (where this script lives)
$ScriptDir = Split-Path -Parent $PSCommandPath
# Scripts dir *is* the CLI dir
$CliDir = $ScriptDir
$SkillRoot = Split-Path -Parent $ScriptDir

Write-Host "Setting up markdown-viewer-cli..." -ForegroundColor Cyan
Write-Host "  Skill root: $SkillRoot" -ForegroundColor Cyan
Write-Host "  CLI dir:    $CliDir" -ForegroundColor Cyan

# Check Node.js
$nodeVersion = node --version 2>$null
if (-not $nodeVersion) {
  Write-Host "ERROR: Node.js is required (v18+). Install from https://nodejs.org" -ForegroundColor Red
  exit 1
}
Write-Host "  Node.js $nodeVersion detected" -ForegroundColor Green

# Install dependencies
Write-Host "  Installing npm dependencies..." -ForegroundColor Yellow
Push-Location $CliDir
try {
  npm install --no-fund --no-audit
  if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
  Write-Host "  Dependencies installed" -ForegroundColor Green
}
finally {
  Pop-Location
}

# Make Unix script executable (best-effort on Windows)
$unixScript = Join-Path $CliDir "mdv"
if (Test-Path $unixScript) {
  try { & "icacls" $unixScript "/grant" "Everyone:RX" 2>$null } catch {}
}

Write-Host ""
Write-Host "Setup complete! Usage:" -ForegroundColor Cyan
Write-Host '  cd "'$SkillRoot'" && mdv render file.md --view'
Write-Host '  mdv convert file.md -t academic'
Write-Host '  mdv themes'
Write-Host ""
Write-Host "Tip: Add this directory to your PATH for system-wide access:"
Write-Host '  $env:Path += ";"'$SkillRoot'"'
