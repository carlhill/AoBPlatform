# Last updated: 24 August 2026, 12:15 pm
#
# Is the development environment actually in the state it looks like?
#
# WHY THIS EXISTS. Twice in one morning the console showed something false
# because of the environment rather than the code:
#
#   * Postgres held every record and the API process was simply not running, so
#     /practice/setup said "the practice you selected no longer exists" and read
#     as data loss.
#   * Two `node --watch` processes fought over port 3001. One held the port
#     running OLD code; the other logged EADDRINUSE and parked itself "waiting
#     for file changes". Edits appeared to have no effect, and the fix was
#     invisible because the service answering was not the service being edited.
#
# Both looked like bugs in the product. Neither was. A check that takes two
# seconds is cheaper than the half hour each of those cost.
#
# Usage:  powershell -File scripts/check-env.ps1
# Exit code 0 when everything is as it should be, 1 when something is not.

$ErrorActionPreference = 'Continue'
$problems = @()

function Report($ok, $label, $detail) {
  $mark = if ($ok) { '  OK  ' } else { ' FAIL ' }
  Write-Host "[$mark] $label - $detail"
  if (-not $ok) { $script:problems += $label }
}

Write-Host ''
Write-Host 'AoBPlatform - environment check'
Write-Host '--------------------------------'

# --- Containers -------------------------------------------------------------
# The core service runs on the HOST, not in a container. Everything it depends
# on runs in one.
$expected = @('postgres', 'keycloak', 'mailhog', 'redis', 'vault', 'rules', 'cube', 'immudb')
$running = @()
try { $running = (docker ps --format '{{.Names}}' 2>$null) } catch {}
foreach ($name in $expected) {
  $up = $running -match $name
  Report ([bool]$up) "container: $name" $(if ($up) { 'running' } else { 'NOT running - docker compose up -d' })
}

# --- Exactly one core -------------------------------------------------------
#
# ONE, not "at least one". Two processes on this port is the failure mode that
# is hardest to see: the one holding the port keeps answering with whatever
# code it started with, so edits do nothing and nothing says why.
$listeners = @(netstat -ano | Select-String 'LISTENING' | Select-String ':3001\s')
$pids = @($listeners | ForEach-Object { ($_ -split '\s+')[-1] } | Sort-Object -Unique)
if ($pids.Count -eq 1) {
  Report $true 'core API (:3001)' "one process, pid $($pids[0])"
} elseif ($pids.Count -eq 0) {
  Report $false 'core API (:3001)' 'NOT running - npm run start:watch -w apps/core'
} else {
  Report $false 'core API (:3001)' "$($pids.Count) processes fighting over the port: $($pids -join ', ')"
}

# Parked watchers hold no port and are invisible to netstat, but they wake on
# the next file change and race whichever process has it.
#
# ONE WATCHER IS TWO PROCESSES. `node --watch` runs a supervisor that restarts a
# child, and both command lines mention main.ts -- so counting processes and
# expecting one flagged a perfectly healthy environment. Count the SUPERVISORS:
# each `--watch` is one person having started the service.
$supervisors = @()
try {
  $supervisors = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -match 'main\.ts' -and $_.CommandLine -match '--watch' })
} catch {}
Report ($supervisors.Count -le 1) 'core watchers' "$($supervisors.Count) watcher(s) - each restarts a child, so one is correct"

# --- It answers, and it is the code on disk ---------------------------------
try {
  $health = Invoke-WebRequest -Uri 'http://localhost:3001/health' -TimeoutSec 3 -UseBasicParsing
  Report ($health.StatusCode -eq 200) 'core /health' "HTTP $($health.StatusCode)"
} catch {
  Report $false 'core /health' 'no answer - the process may be starting, or crashed on load'
}

# --- The console ------------------------------------------------------------
$web = @(netstat -ano | Select-String 'LISTENING' | Select-String ':3100\s')
Report ($web.Count -gt 0) 'console (:3100)' $(if ($web.Count -gt 0) { 'running' } else { 'NOT running - npm run dev -w apps/web' })

# --- Migrations -------------------------------------------------------------
#
# A schema behind the code is the same class of problem: the app looks broken
# and the cause is not in the app.
Push-Location "$PSScriptRoot\..\apps\core"
$env:DATABASE_URL = 'postgresql://aobplatform:aobplatform@127.0.0.1:21020/aobplatform?schema=core'
$status = (npx prisma migrate status 2>&1 | Out-String)
Pop-Location
Report ($status -match 'up to date|No pending migrations') 'migrations' $(
  if ($status -match 'up to date|No pending migrations') { 'applied' } else { 'PENDING - npx prisma migrate deploy -w apps/core' }
)

# --- The built domain package -----------------------------------------------
#
# The console imports @aobplatform/domain from its BUILT dist. Editing the
# source and not rebuilding means the browser runs the old rules while the
# tests pass against the new ones - which has already cost an afternoon once.
$src = "$PSScriptRoot\..\packages\domain\src"
$dist = "$PSScriptRoot\..\packages\domain\dist"
if (Test-Path $dist) {
  # Tests are not compiled into dist, so a newer test file does not make the
  # build stale. Comparing against them reported a perfectly fresh dist as out
  # of date, which is the fastest way to teach somebody to ignore a check.
  $newestSrc = (Get-ChildItem $src -Recurse -Filter *.ts |
    Where-Object { $_.Name -notmatch '\.test\.ts$' } |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime
  # THE NEWEST OUTPUT, not index.js. tsc only rewrites the files whose output
  # actually changed, so index.js keeps an old timestamp through a perfectly
  # successful build -- and comparing against it reported every fresh build as
  # stale.
  $built = (Get-ChildItem $dist -Recurse -Filter *.js |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime
  Report ($built -ge $newestSrc) 'domain dist' $(
    if ($built -ge $newestSrc) { 'newer than src' } else { 'STALE - npm run build -w packages/domain' }
  )
} else {
  Report $false 'domain dist' 'not built - npm run build -w packages/domain'
}

Write-Host ''
if ($problems.Count -eq 0) {
  Write-Host 'Everything is as it should be.'
  exit 0
}
Write-Host "$($problems.Count) problem(s): $($problems -join ', ')"
exit 1
