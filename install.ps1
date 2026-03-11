[CmdletBinding()]
param(
  [string]$SourceDir,
  [switch]$PreferRemote
)

$ErrorActionPreference = 'Stop'

function Write-Info([string]$Message) {
  Write-Host "  > $Message" -ForegroundColor Cyan
}

function Write-Success([string]$Message) {
  Write-Host "  + $Message" -ForegroundColor Green
}

function Write-Warn([string]$Message) {
  Write-Host "  ! $Message" -ForegroundColor Yellow
}

function Fail([string]$Message) {
  throw $Message
}

function Require-Command([string]$Name, [string]$ErrorMessage) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    Fail $ErrorMessage
  }
}

function Get-AntigravityCliPath {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Antigravity\bin\antigravity.cmd'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Antigravity\bin\antigravity'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Antigravity\Antigravity.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Antigravity\resources\app\bin\antigravity.cmd'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Antigravity\resources\app\bin\antigravity')
  )

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) {
      return $candidate
    }
  }

  return $null
}

function Test-RepoRoot([string]$Path) {
  if (-not $Path) {
    return $false
  }

  return (
    (Test-Path (Join-Path $Path 'package.json')) -and
    (Test-Path (Join-Path $Path 'packages\cli\package.json')) -and
    (Test-Path (Join-Path $Path 'packages\extension\package.json'))
  )
}

function Resolve-LocalSourceDir {
  if ($PreferRemote) {
    return $null
  }

  if ($SourceDir) {
    $resolved = (Resolve-Path -Path $SourceDir).Path
    if (-not (Test-RepoRoot $resolved)) {
      Fail "SourceDir is not an antigravity-cli repository root: $resolved"
    }
    return $resolved
  }

  if ($PSScriptRoot -and (Test-RepoRoot $PSScriptRoot)) {
    return (Resolve-Path -Path $PSScriptRoot).Path
  }

  return $null
}

function Sync-LocalSource([string]$SourcePath, [string]$DestinationPath) {
  $sourceRoot = (Resolve-Path -Path $SourcePath).Path
  $destinationRoot = $DestinationPath

  if ($sourceRoot.TrimEnd('\') -ieq $destinationRoot.TrimEnd('\')) {
    return
  }

  New-Item -ItemType Directory -Force -Path $destinationRoot | Out-Null

  $robocopyArgs = @(
    $sourceRoot,
    $destinationRoot,
    '/MIR',
    '/FFT',
    '/XD',
    (Join-Path $sourceRoot '.git'),
    (Join-Path $sourceRoot 'node_modules'),
    (Join-Path $sourceRoot 'packages\cli\node_modules'),
    (Join-Path $sourceRoot 'packages\sdk\node_modules'),
    (Join-Path $sourceRoot 'packages\extension\node_modules')
  )

  & robocopy @robocopyArgs | Out-Null
  if ($LASTEXITCODE -ge 8) {
    Fail "robocopy sync failed with exit code $LASTEXITCODE"
  }
}

$repoUrl = 'https://github.com/professional-ALFIE/antigravity-cli.git'
$dataDir = Join-Path $env:USERPROFILE '.antigravity-cli'
$installDir = Join-Path $dataDir 'source'
$binDir = Join-Path $env:USERPROFILE '.local\bin'
$localSourceDir = Resolve-LocalSourceDir

Write-Host ''
Write-Host '  antigravity-cli installer (Windows)' -ForegroundColor White
Write-Host '  Antigravity IDE bridge CLI for PowerShell and cmd.exe' -ForegroundColor DarkGray
Write-Host ''

Write-Info 'Checking prerequisites...'
Require-Command git 'git is required. https://git-scm.com'
Require-Command node 'Node.js 18+ is required. https://nodejs.org'
Require-Command npm 'npm is required.'

$nodeMajor = [int](& node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 18) {
  Fail "Node.js 18 or newer is required. Current: $(node -v)"
}

Write-Success 'Prerequisite check complete'

New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

if ($localSourceDir) {
  Write-Info "Syncing local source: $localSourceDir"
  Sync-LocalSource -SourcePath $localSourceDir -DestinationPath $installDir
  Write-Success 'Local source sync complete'
} else {
  if (Test-Path (Join-Path $installDir '.git')) {
    Write-Info 'Updating existing installation from upstream...'
    & git -C $installDir fetch origin
    if ($LASTEXITCODE -ne 0) { Fail 'git fetch failed' }
    & git -C $installDir reset --hard origin/main
    if ($LASTEXITCODE -ne 0) { Fail 'git reset failed' }
  } else {
    Write-Info 'Cloning repository from upstream...'
    if (Test-Path $installDir) {
      Remove-Item -Recurse -Force $installDir
    }
    & git clone --depth 1 $repoUrl $installDir
    if ($LASTEXITCODE -ne 0) { Fail 'git clone failed' }
  }
}

Push-Location $installDir
try {
  Write-Info 'Installing dependencies...'
  & npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Fail 'npm install failed' }
  Write-Success 'Dependencies installed'

  Write-Info 'Building SDK...'
  & npm -w packages/sdk run build --silent
  if ($LASTEXITCODE -ne 0) { Fail 'SDK build failed' }
  Write-Success 'SDK build complete'

  Write-Info 'Building extension...'
  & npm -w packages/extension run build --silent
  if ($LASTEXITCODE -ne 0) { Fail 'Extension build failed' }
  Write-Success 'Extension build complete'

  $extensionDir = Join-Path $installDir 'packages\extension'
  Push-Location $extensionDir
  try {
    Write-Info 'Packaging VSIX...'
    & npx -y @vscode/vsce package --no-dependencies
    if ($LASTEXITCODE -ne 0) { Fail 'VSIX packaging failed' }
    $vsixFile = Get-ChildItem *.vsix | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  } finally {
    Pop-Location
  }

  if (-not $vsixFile) {
    Fail 'VSIX file not found after packaging'
  }

  Write-Success "VSIX packaged: $($vsixFile.Name)"

  $agCli = Get-AntigravityCliPath
  if ($agCli) {
    Write-Info 'Installing extension into Antigravity...'
    & $agCli --install-extension $vsixFile.FullName --force
    if ($LASTEXITCODE -ne 0) { Fail 'Extension install failed' }
    Write-Success 'Extension install complete'
  } else {
    Write-Warn 'Antigravity CLI was not found. Install the VSIX manually from Antigravity.'
    Write-Host "    File: $($vsixFile.FullName)" -ForegroundColor DarkGray
  }

  Write-Info 'Creating CLI wrappers...'
  New-Item -ItemType Directory -Force -Path $binDir | Out-Null

  $ps1Wrapper = @'
$dir = Join-Path $env:USERPROFILE '.antigravity-cli\source'
$tsx = Join-Path $dir 'node_modules\.bin\tsx.cmd'
if (-not (Test-Path $tsx)) {
  $tsx = Join-Path $dir 'packages\cli\node_modules\.bin\tsx.cmd'
}
if (-not (Test-Path $tsx)) {
  Write-Error "tsx not found. Run npm install in $dir."
  exit 1
}
& $tsx (Join-Path $dir 'packages\cli\bin\antigravity-cli.ts') @args
exit $LASTEXITCODE
'@

  $cmdWrapper = @'
@echo off
set "DIR=%USERPROFILE%\.antigravity-cli\source"
set "TSX=%DIR%\node_modules\.bin\tsx.cmd"
if not exist "%TSX%" set "TSX=%DIR%\packages\cli\node_modules\.bin\tsx.cmd"
if not exist "%TSX%" (
  echo tsx not found. Run npm install in %DIR%.
  exit /b 1
)
"%TSX%" "%DIR%\packages\cli\bin\antigravity-cli.ts" %*
'@

  [System.IO.File]::WriteAllText((Join-Path $binDir 'antigravity-cli.ps1'), $ps1Wrapper, [System.Text.UTF8Encoding]::new($false))
  [System.IO.File]::WriteAllText((Join-Path $binDir 'antigravity-cli.cmd'), $cmdWrapper, [System.Text.UTF8Encoding]::new($false))
  [System.IO.File]::WriteAllText((Join-Path $binDir 'ag.ps1'), $ps1Wrapper, [System.Text.UTF8Encoding]::new($false))
  [System.IO.File]::WriteAllText((Join-Path $binDir 'ag.cmd'), $cmdWrapper, [System.Text.UTF8Encoding]::new($false))
  Write-Success "CLI wrappers created in $binDir"

  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $pathEntries = @()
  if ($userPath) {
    $pathEntries = $userPath.Split(';', [System.StringSplitOptions]::RemoveEmptyEntries)
  }

  if (-not ($pathEntries | Where-Object { $_.TrimEnd('\') -ieq $binDir.TrimEnd('\') })) {
    Write-Warn "$binDir is not in your user PATH."
    Write-Host '    Add it once with:' -ForegroundColor DarkGray
    Write-Host "    [Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path', 'User') + ';$binDir', 'User')" -ForegroundColor Cyan
  }

  Write-Host ''
  Write-Host '  Installation complete' -ForegroundColor Green
  Write-Host ''
  Write-Host '  Usage:' -ForegroundColor White
  Write-Host '    antigravity-cli --help' -ForegroundColor Cyan
  Write-Host '    antigravity-cli            # interactive REPL' -ForegroundColor Cyan
  Write-Host '    ag                         # short alias' -ForegroundColor Cyan
  Write-Host '    antigravity-cli "Review this module"' -ForegroundColor Cyan
  Write-Host '    antigravity-cli server status' -ForegroundColor Cyan
  Write-Host ''
} finally {
  Pop-Location
}
