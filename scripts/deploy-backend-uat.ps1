#requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$PreflightOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Fixed UAT targets. Do not turn these into user-controlled workflow inputs.
$serviceName = 'BES-API-UAT'
$target = 'F:\bes_backend_uat'
$backupRoot = 'F:\Fixes\BES_Backend_CICD_Backups'
$node = 'C:\Program Files\nodejs\node.exe'
$npmCli = 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js'
$curl = Join-Path $env:SystemRoot 'System32\curl.exe'
$healthUrl = 'http://127.0.0.1:7001/api/v1/auth/me'
$source = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$managedFolders = @('src', 'assets', 'scripts', 'node_modules')
$managedFiles = @('server.js', 'package.json', 'package-lock.json')

function Copy-Tree {
    param([string]$From, [string]$To, [switch]$Mirror)
    if (-not (Test-Path -LiteralPath $From -PathType Container)) {
        throw "Required source folder was not found: $From"
    }
    $options = @('/E', '/XJ', '/COPY:DAT', '/DCOPY:DAT', '/R:2', '/W:1', '/NFL', '/NDL', '/NP')
    if ($Mirror) { $options += '/PURGE' }
    # Existing uploads below src are runtime data, not deployable source.
    $options += @('/XD', 'uploads', '/XF', '*.bak', '.env', '.env.*', '*.log')
    & robocopy.exe $From $To @options | Out-Host
    $copyExitCode = $LASTEXITCODE
    if ($copyExitCode -ge 8) {
        throw "Robocopy failed with exit code $copyExitCode ($From -> $To)."
    }
}

function Copy-Managed {
    param([string]$From, [string]$To, [switch]$Mirror)
    foreach ($folder in $managedFolders) {
        Copy-Tree -From (Join-Path $From $folder) -To (Join-Path $To $folder) -Mirror:$Mirror
    }
    foreach ($file in $managedFiles) {
        Copy-Item -LiteralPath (Join-Path $From $file) -Destination (Join-Path $To $file) -Force
    }
}

function Test-Backend {
    $responseFile = Join-Path $env:RUNNER_TEMP ('bes-health-' + [guid]::NewGuid().ToString('N') + '.json')
    try {
        $status = & $curl --silent --show-error --max-time 5 --output $responseFile --write-out '%{http_code}' $healthUrl
        $requestExitCode = $LASTEXITCODE
        if ($requestExitCode -ne 0 -or ([string]$status).Trim() -ne '401') { return $false }
        $body = Get-Content -LiteralPath $responseFile -Raw | ConvertFrom-Json
        return ($body.success -eq $false -and $body.message -eq 'Unauthorized: No token provided.')
    }
    catch { return $false }
    finally { Remove-Item -LiteralPath $responseFile -Force -ErrorAction SilentlyContinue }
}

function Wait-Backend {
    foreach ($attempt in 1..15) {
        $current = Get-Service -Name $serviceName
        if ($current.Status -eq 'Running' -and (Test-Backend)) { return }
        Start-Sleep -Seconds 2
    }
    throw 'UAT backend did not pass the localhost readiness check.'
}

function Stop-Backend {
    $current = Get-Service -Name $serviceName
    if ($current.Status -ne 'Stopped') {
        $current.Stop()
        $current.WaitForStatus([ServiceProcess.ServiceControllerStatus]::Stopped, [TimeSpan]::FromSeconds(60))
    }
}

function Start-Backend {
    $current = Get-Service -Name $serviceName
    if ($current.Status -ne 'Running') { $current.Start() }
    $current.WaitForStatus([ServiceProcess.ServiceControllerStatus]::Running, [TimeSpan]::FromSeconds(60))
    Wait-Backend
}

if (-not $env:GITHUB_WORKSPACE -or -not $env:RUNNER_TEMP) {
    throw 'Run this script from the BES UAT GitHub Actions deployment job.'
}
if ([IO.Path]::GetFullPath($env:GITHUB_WORKSPACE).TrimEnd('\') -ne $source.TrimEnd('\')) {
    throw 'The script must run from the checked-out repository.'
}
if ($env:GITHUB_REF -ne 'refs/heads/uat-deployed') {
    throw 'Only the uat-deployed branch may deploy to UAT.'
}
if ($env:GITHUB_REPOSITORY -ne 'errorDar/bes-backend-1027') {
    throw 'Unexpected source repository.'
}
if (-not (Test-Path -LiteralPath $target -PathType Container) -or
    -not (Test-Path -LiteralPath $backupRoot -PathType Container)) {
    throw 'The UAT backend and backup directories must already exist.'
}
foreach ($required in @($node, $npmCli, $curl, "$target\.env")) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Required file was not found: $required"
    }
}
foreach ($folder in $managedFolders) {
    if (-not (Test-Path -LiteralPath (Join-Path $target $folder) -PathType Container)) {
        throw "Current deployment is missing managed folder: $folder"
    }
}
foreach ($file in $managedFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $target $file) -PathType Leaf)) {
        throw "Current deployment is missing managed file: $file"
    }
}

$parameters = Get-ItemProperty -LiteralPath "HKLM:\SYSTEM\CurrentControlSet\Services\$serviceName\Parameters"
if ($parameters.AppDirectory -ne $target -or $parameters.Application -ne $node -or
    $parameters.AppParameters.Trim() -ne '--env-file=.env server.js') {
    throw 'NSSM configuration differs from the reviewed UAT configuration.'
}
if ((Get-Service -Name $serviceName).Status -ne 'Running' -or -not (Test-Backend)) {
    throw 'Current UAT backend must be running and responsive before deploying.'
}
$environmentHash = (Get-FileHash -LiteralPath "$target\.env" -Algorithm SHA256).Hash
$nodeVersion = (& $node --version).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v24\.') {
    throw 'The UAT runtime must be Node.js 24.x. Coordinate runtime changes separately.'
}
Write-Host "UAT runtime: $nodeVersion"

$releaseId = "$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT"
$stage = Join-Path $env:RUNNER_TEMP ('bes-uat-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
foreach ($folder in @('src', 'assets', 'scripts')) {
    Copy-Tree -From (Join-Path $source $folder) -To (Join-Path $stage $folder)
}
foreach ($file in $managedFiles) {
    Copy-Item -LiteralPath (Join-Path $source $file) -Destination (Join-Path $stage $file)
}

# Install production dependencies with the actual service runtime before downtime.
Push-Location $stage
try {
    & $node $npmCli ci --omit=dev | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Production dependency installation failed.' }
    & $node --check server.js | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Entry-point syntax check failed.' }
}
finally { Pop-Location }

if ($PreflightOnly) {
    Write-Host 'Preflight passed. Dependencies prepared; running backend was not stopped or changed.'
    exit 0
}

$backup = Join-Path $backupRoot $releaseId
if (Test-Path -LiteralPath $backup) { throw 'Backup directory already exists; refusing to overwrite it.' }
New-Item -ItemType Directory -Path $backup | Out-Null
Copy-Managed -From $target -To $backup
@{
    commit = $env:GITHUB_SHA
    runtime = $nodeVersion
    service = $serviceName
    createdUtc = [DateTime]::UtcNow.ToString('o')
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backup 'deployment.json') -Encoding UTF8
Write-Host "Backup completed: $backup"

$filesChanged = $false
$stopAttempted = $false
try {
    $stopAttempted = $true
    Stop-Backend
    $filesChanged = $true
    # Mirroring is restricted to these four managed directories, never the app root.
    Copy-Managed -From $stage -To $target -Mirror
    if ((Get-FileHash -LiteralPath "$target\.env" -Algorithm SHA256).Hash -ne $environmentHash) {
        throw '.env changed during deployment. Investigate before continuing.'
    }
    Start-Backend
    if ((Get-Service -Name $serviceName).Status -ne 'Running') {
        throw 'UAT service is no longer running.'
    }
    Write-Host "BES UAT backend deployment passed. Commit: $env:GITHUB_SHA"
    Write-Host "Backup: $backup"
}
catch {
    $deploymentFailure = $_.Exception.Message
    Write-Warning "Deployment failed: $deploymentFailure"
    try {
        if ($filesChanged) {
            Stop-Backend
            Copy-Managed -From $backup -To $target -Mirror
        }
        if ($stopAttempted) { Start-Backend }
        Write-Warning "Previous backend restored and responsive. Backup: $backup"
    }
    catch {
        throw "Deployment failed: $deploymentFailure. Recovery also failed: $($_.Exception.Message). Backup: $backup"
    }
    throw "Deployment failed and the previous backend was restored: $deploymentFailure"
}

exit 0
