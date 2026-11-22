$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
    throw 'Node.js 24 is required.'
}
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules'))) {
    $cachePath = Join-Path (Split-Path -Parent $projectRoot) '.task-tmp\npm-cache'
    npm.cmd ci --cache "$cachePath"
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
Write-Host 'Frontend: http://127.0.0.1:5173/'
Write-Host 'Demo: http://127.0.0.1:5173/?demo=1'
npm.cmd run dev
