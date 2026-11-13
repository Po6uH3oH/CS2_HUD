param([ValidateSet('overlay','browser','setup')][string]$Mode = 'overlay')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$runtimeRoot = Join-Path $projectRoot '.runtime'
$logRoot = Join-Path $projectRoot 'data'
$setupLock = $null
$transcribing = $false
try {
    if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { throw 'This release needs Windows x64 (Intel/AMD), Windows 10 or newer.' }
    New-Item -ItemType Directory -Force -Path $runtimeRoot,$logRoot | Out-Null
    Start-Transcript -Path (Join-Path $logRoot 'setup.log') -Append | Out-Null
    $transcribing = $true
    try { $setupLock = [IO.File]::Open((Join-Path $runtimeRoot 'setup.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
    catch { throw 'HUD setup is already running. Wait for the other window to finish, then try again.' }
    $config = Get-Content -LiteralPath (Join-Path $projectRoot 'config/runtime.json') -Raw | ConvertFrom-Json
    $nodeDir = Join-Path $runtimeRoot "node-v$($config.nodeVersion)-win-x64"
    $node = Join-Path $nodeDir 'node.exe'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    if (-not (Test-Path -LiteralPath $node)) {
        Write-Host '[1/4] Downloading local Node.js. No administrator rights needed...'
        $zip = Join-Path $runtimeRoot 'node-download.zip'
        Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v$($config.nodeVersion)/node-v$($config.nodeVersion)-win-x64.zip" -OutFile $zip
        if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $config.nodeSha256) { throw 'Node.js checksum mismatch. Download was not used. Please retry.' }
        Expand-Archive -LiteralPath $zip -DestinationPath $runtimeRoot -Force
        Remove-Item -LiteralPath $zip
    }
    & $node -e "if (Number(process.versions.node.split('.')[0]) < 24) process.exit(1)"
    if ($LASTEXITCODE -ne 0) { throw 'Local Node.js is damaged. Remove only the .runtime folder and retry.' }
    $env:PATH = "$nodeDir;$env:PATH"
    $env:HUD_NODE = $node
    $toolsDir = Join-Path $runtimeRoot 'tools'
    $pnpm = Join-Path $toolsDir 'node_modules/pnpm/bin/pnpm.cjs'
    if (-not (Test-Path -LiteralPath $pnpm)) {
        Write-Host '[2/4] Preparing the dependency installer...'
        & $node (Join-Path $nodeDir 'node_modules/npm/bin/npm-cli.js') install --prefix $toolsDir "pnpm@$($config.pnpmVersion)" --ignore-scripts --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Could not download pnpm. Check Internet access to registry.npmjs.org and retry.' }
    }
    $fingerprint = @('package.json','pnpm-lock.yaml','pnpm-workspace.yaml','config/runtime.json') | ForEach-Object { (Get-FileHash -LiteralPath (Join-Path $projectRoot $_) -Algorithm SHA256).Hash }
    $fingerprint = $fingerprint -join ':'
    $marker = Join-Path $runtimeRoot 'dependencies.sha256'
    & $node scripts/check-runtime.mjs
    $healthy = $LASTEXITCODE -eq 0
    if (-not $healthy -or -not (Test-Path -LiteralPath $marker) -or (Get-Content -LiteralPath $marker -Raw).Trim() -ne $fingerprint) {
        Write-Host '[3/4] Installing or repairing dependencies. The first run may take several minutes...'
        & $node $pnpm install --frozen-lockfile --force --config.node-linker=hoisted
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check the messages above and data/setup.log, then retry.' }
        if (-not (Test-Path -LiteralPath 'node_modules/electron/dist/electron.exe')) {
            & $node node_modules/electron/install.js
            if ($LASTEXITCODE -ne 0) { throw 'Electron download failed. Check access to github.com and retry.' }
        }
        & $node scripts/check-runtime.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Dependencies did not pass verification. See data/setup.log.' }
        Set-Content -LiteralPath $marker -Value $fingerprint -Encoding ascii
    }
    Write-Host '[4/4] Checking the HUD build...'
    & $node scripts/prepare.mjs
    if ($LASTEXITCODE -ne 0) { throw 'HUD build failed. See data/setup.log.' }
    $setupLock.Dispose(); $setupLock = $null
    if ($Mode -eq 'setup') { Write-Host 'Setup complete.' }
    elseif ($Mode -eq 'overlay') {
        Start-Process -FilePath (Join-Path $projectRoot 'node_modules/electron/dist/electron.exe') -ArgumentList ('"' + (Join-Path $projectRoot 'apps/desktop/main.cjs') + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden
    } else {
        & $node scripts/start-browser.mjs
        if ($LASTEXITCODE -ne 0) { throw 'HUD server stopped with an error. See data/setup.log.' }
    }
} catch {
    Write-Host "`nHUD could not start: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Log: $logRoot\setup.log"
    exit 1
} finally {
    if ($setupLock) { $setupLock.Dispose() }
    if ($transcribing) { Stop-Transcript | Out-Null }
}
