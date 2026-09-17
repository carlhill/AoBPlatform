<#
.SYNOPSIS
    Creates (or removes) the AOBPRINTER print queue on a practice desktop.

.DESCRIPTION
    AOBPRINTER is an ordinary Windows printer on a FILE-PATH LOCAL PORT using the
    built-in "Microsoft Print To PDF" driver. Printing to it writes a PDF straight
    to that path with no save dialog and no user interaction.

    WHY THIS SHAPE, AND WHY IT MATTERS COMMERCIALLY. There is no driver to write,
    so there is no kernel-mode or user-mode print driver to get WHQL-signed, no
    driver package to maintain per Windows build, and nothing for a practice's IT
    policy to block. The driver is Microsoft's, shipped in the box since Windows
    10. What we install is a port and a queue — two registry-backed objects that
    any local administrator can create, inspect and remove. (The service that
    reads the spool is a separate install; this script does the printer only.)

    ONE HOST, ONE QUEUE PER WORKSTATION (-Mode Lan). A large practice runs ONE
    AOBPRINTER host and the workstations install nothing: they connect to shared
    queues over the LAN. They do NOT share one queue, and that distinction is the
    whole design. A port is a single fixed file path and the spooler OVERWRITES
    it, so two jobs seconds apart destroy the first before the watcher claims it
    -- a consent form lost, silently, at exactly the busy moment that produced
    it. So the host carries one queue per workstation, each with its own port and
    its own file, all watched by one service.

    WHAT IT DOES NOT DO. It does not touch the default printer and it does not
    install the watcher service. A practice that runs this and nothing else has
    printers that quietly write PDFs to a folder, which is harmless.

    IDEMPOTENT, BOTH WAYS. Run it twice and the second run reports what already
    existed and changes nothing. Run it with -Uninstall twice and the second run
    reports what was already gone. That is not politeness: this will be run by a
    remote-support technician over a phone call, and "run it again" must always
    be a safe instruction.

.PARAMETER PrinterName
    The queue name the practice prints to. Default AOBPRINTER.

.PARAMETER SpoolFile
    The file-path port. Every job OVERWRITES this file — the watcher claims each
    job out of it immediately, which is why one path is enough.

.PARAMETER Uninstall
    Remove the queue and the port. The spool folder and anything in it are left
    alone: a folder may hold a form that has not been sent yet, and this script
    does not get to decide that a practice's evidence is disposable.

.EXAMPLE
    .\Install-AobPrinter.ps1
    .\Install-AobPrinter.ps1 -Uninstall

.EXAMPLE
    # A practice host serving three consulting rooms.
    .\Install-AobPrinter.ps1 -Mode Lan -Queues @(
        @{ Name='AOBPRINTER-Room1'; SpoolFile='C:\ProgramData\AoBPlatform\spool
oom1.pdf'; Label='Room 1' },
        @{ Name='AOBPRINTER-Room3'; SpoolFile='C:\ProgramData\AoBPlatform\spool
oom3.pdf'; Label='Room 3' },
        @{ Name='AOBPRINTER-Desk';  SpoolFile='C:\ProgramData\AoBPlatform\spool\desk.pdf';  Label='Front desk' })

.NOTES
    Verified on Windows 11 Home (build 26200), 17 September 2026, WITHOUT elevation:
    Add-Printer, Remove-Printer and Add-PrinterPort all succeed as an ordinary
    user there. Group policy may still require elevation; see the note below.
#>
[CmdletBinding()]
param(
    [string] $PrinterName = 'AOBPRINTER',
    [string] $SpoolFile = 'C:\ProgramData\AoBPlatform\spool\aobprinter-out.pdf',
    [ValidateSet('Single', 'Lan')]
    [string] $Mode = 'Single',
    [object[]] $Queues,
    [string] $DataDir = 'C:\ProgramData\AoBPlatform',
    [switch] $SkipVersionCheck,
    [switch] $Uninstall
)

$ErrorActionPreference = 'Stop'

$DriverName = 'Microsoft Print To PDF'
$SpoolFolder = Split-Path -Parent $SpoolFile

function Write-Step { param([string] $Message) Write-Host "  $Message" }

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

<#
    IT ASKS FOR ELEVATION, IT DOES NOT DEMAND IT.

    The obvious thing to write here is `if (-not admin) { throw }`, and it was
    written that way first. It is wrong: measured on Windows 11 Home (build
    26200) on 17 September 2026, an ordinary user CAN add and remove a local
    printer and a file port — `Add-Printer`, `Remove-Printer`,
    `Add-PrinterPort` all succeeded unelevated. Refusing to try would have
    turned a working install into a support call about administrator rights the
    practice did not need.

    Group policy can and does forbid it on a managed desktop, so the warning
    stays and the failure below is caught and explained rather than shown as a
    raw COM error. Attempt, then advise — never advise instead of attempting.
#>
$script:Elevated = Test-Administrator
if (-not $script:Elevated) {
    Write-Warning 'Not running elevated. Adding a local printer usually works without it; if a step below is refused, re-run from an elevated PowerShell.'
}

function Invoke-PrinterStep {
    param([string] $What, [scriptblock] $Action)
    try {
        & $Action
    }
    catch {
        if (-not $script:Elevated) {
            throw "$What was refused ($($_.Exception.Message)). This desktop requires administrator rights for it; re-run from an elevated PowerShell."
        }
        throw
    }
}

<#
    THE QUEUE LIST IS THE WHOLE JOB, AND ONE QUEUE IS JUST A LIST OF ONE.

    A single-workstation install and a practice host serving six rooms differ
    only in how many entries come back from here. There is deliberately no
    "single" code path to drift out of step with the "LAN" one.
#>
function Resolve-QueueList {
    if (-not $Queues -or $Queues.Count -eq 0) {
        return , ([pscustomobject]@{ Name = $PrinterName; SpoolFile = $SpoolFile; Label = $PrinterName })
    }

    $resolved = @()
    $seenNames = @{}
    $seenPaths = @{}
    $index = 0
    foreach ($entry in $Queues) {
        $index++
        $name = $entry['Name']
        $path = $entry['SpoolFile']
        $label = $entry['Label']
        if ([string]::IsNullOrWhiteSpace($name)) { throw "Queue $index has no Name." }
        if ([string]::IsNullOrWhiteSpace($path)) {
            throw "Queue '$name' has no SpoolFile. Every queue watches its own file-path port; there is no shared default."
        }
        if ([string]::IsNullOrWhiteSpace($label)) { $label = $name }

        if ($seenNames.ContainsKey($name)) { throw "Two queues are both named '$name'. A queue name is how a form says where it came from." }

        # THE ONE CHECK THAT PREVENTS DATA LOSS. Two queues on one port means the
        # spooler overwrites one job with the next, and a consent form is gone
        # before the watcher ever sees it.
        $key = $path.ToLowerInvariant()
        if ($seenPaths.ContainsKey($key)) {
            throw "Queues '$($seenPaths[$key])' and '$name' both spool to $path. Every queue MUST have its own file, or a form printed on one is destroyed by a job on the other."
        }
        $seenNames[$name] = $true
        $seenPaths[$key] = $name
        $resolved += [pscustomobject]@{ Name = $name; SpoolFile = $path; Label = $label }
    }
    return $resolved
}

function Get-PackageVersion {
    $packageJson = Join-Path $PSScriptRoot '..\package.json'
    if (-not (Test-Path -LiteralPath $packageJson)) { throw "Cannot find $packageJson to read the version from." }
    return (Get-Content -LiteralPath $packageJson -Raw | ConvertFrom-Json).version
}

function Get-InstallCliPath {
    $cli = Join-Path $PSScriptRoot '..\dist\src\install-cli.js'
    if (Test-Path -LiteralPath $cli) { return (Resolve-Path -LiteralPath $cli).Path }
    return $null
}

<#
    CALLING NODE FROM WINDOWS POWERSHELL 5.1, DELIBERATELY.

    5.1 wraps each line a native command writes to stderr in an ErrorRecord,
    and with $ErrorActionPreference = 'Stop' that makes ordinary stderr output
    TERMINATING. Measured 17 September 2026: the version guard worked
    correctly, refused an older build, and the practice saw a NativeCommandError
    stack trace instead of the sentence explaining what to do -- while this
    script's own message never printed at all, because the throw below it was
    never reached.

    So: stderr goes to a file, the exit code is read on purpose, and the caller
    decides what the human sees. The preference is set inside the function,
    where it is dynamically scoped to this call and nothing else.
#>
function Invoke-NodeCli {
    param([Parameter(Mandatory)][string[]] $NodeArgs)

    $ErrorActionPreference = 'Continue'
    $errFile = [System.IO.Path]::GetTempFileName()
    try {
        $out = & node @NodeArgs 2>$errFile
        return [pscustomobject]@{
            ExitCode = $LASTEXITCODE
            StdOut   = ($out | Out-String).Trim()
            StdErr   = ((Get-Content -LiteralPath $errFile -Raw -ErrorAction SilentlyContinue) -replace '(?m)^node(\.exe)? : ', '')
        }
    }
    finally {
        Remove-Item -LiteralPath $errFile -Force -ErrorAction SilentlyContinue
    }
}

<#
    THE SINGLE-VERSION GUARD RAIL, ASKED OF THE PROGRAM BEING INSTALLED.

    Version ordering is one line to write and quietly wrong forever ("0.10.0"
    sorts before "0.9.0" as text), and there is no test runner pointed at this
    file. `install-marker.ts` holds the decision with unit tests behind it, and
    `install-cli.js` is the three lines of glue that let this script gate on an
    exit code. Node is not a new dependency: AOBPRINTER does not run without it.

    IT FAILS CLOSED. If the CLI is missing, this stops rather than installing
    blind over whatever is already there -- an installer that cannot establish
    what is present must not proceed as if nothing were. -SkipVersionCheck is
    for development, and says so on the way past.
#>
function Assert-VersionAllowed {
    param([string] $Version)

    if ($SkipVersionCheck) {
        Write-Warning "Skipping the single-version check (-SkipVersionCheck). An older build may be installed over a newer one."
        return
    }

    $cli = Get-InstallCliPath
    if (-not $cli) {
        throw "Cannot find dist\src\install-cli.js, so the installed version cannot be checked. Build it first (npm run build -w apps/aobprinter), or pass -SkipVersionCheck if you are developing."
    }

    $result = Invoke-NodeCli -NodeArgs @($cli, 'check', $Version, $DataDir)

    if ($result.ExitCode -eq 1) {
        # The CLI's own sentence is the useful one -- it names both versions and
        # what to do -- so it is shown, not paraphrased.
        throw ($result.StdErr).Trim()
    }
    if ($result.ExitCode -ne 0) {
        throw "The version check could not be completed, so nothing has been changed: $(($result.StdErr).Trim())"
    }

    $action = ($result.StdOut | ConvertFrom-Json).action
    switch ($action) {
        'fresh'   { Write-Step "No AOBPRINTER installed here yet; installing $Version." }
        'same'    { Write-Step "AOBPRINTER $Version is already installed; re-running is idempotent." }
        'upgrade' { Write-Step "Upgrading to AOBPRINTER $Version in place." }
    }
}

function Write-InstallMarker {
    param([string] $Version, [object[]] $QueueList)

    $cli = Get-InstallCliPath
    if (-not $cli) { Write-Warning "No install-cli.js; the install marker was not written, so the next install cannot tell what is here."; return }

    # Via a FILE, not argv. PowerShell 5.1 re-parses a native command's
    # arguments with its own legacy rules and JSON is nothing but embedded
    # quotes -- inline, they are eaten on one desktop and survive on another,
    # and the damage shows up as a mangled label in a receipt weeks later.
    $payload = @($QueueList | ForEach-Object { @{ name = $_.Name; label = $_.Label } })
    $json = ConvertTo-Json -InputObject $payload -Compress -Depth 4
    if (-not $json.StartsWith('[')) { $json = "[$json]" }   # PS 5.1 unwraps a one-element array

    $temp = Join-Path ([System.IO.Path]::GetTempPath()) ("aobprinter-queues-" + [guid]::NewGuid().ToString('N') + ".json")
    try {
        Set-Content -LiteralPath $temp -Value $json -Encoding utf8
        $result = Invoke-NodeCli -NodeArgs @($cli, 'write', $Version, $DataDir, $Mode, "@$temp")
        if ($result.ExitCode -ne 0) { throw "Writing the install marker failed: $(($result.StdErr).Trim())" }
        Write-Step "Recorded version $Version, mode $Mode and $($QueueList.Count) queue(s) in the install marker."
    }
    finally {
        Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
    }
}

<#
    RECONCILIATION NEEDS THE PRINT SERVICE LOG, AND WINDOWS SHIPS IT DISABLED.

    AOBPRINTER compares the spooler's completed-job count per queue against the
    forms it actually claimed, so that a form printed but never captured is an
    alarm instead of a silence. That comparison has nothing to read unless this
    log is on. It is off by default on every Windows desktop.

    IT WARNS, IT DOES NOT FAIL. Enabling an event log usually needs elevation
    and a managed desktop may forbid it. Refusing to install a working print
    channel because a REPORTING feature could not be enabled would be the wrong
    trade every time (hard rule 8): capture still works, reconciliation says it
    is degraded, and the practice is told here rather than discovering it later.
#>
function Enable-PrintServiceLog {
    $log = 'Microsoft-Windows-PrintService/Operational'
    try {
        $state = & wevtutil gl $log 2>&1
        if ($LASTEXITCODE -ne 0) { throw "wevtutil could not read $log." }
        if ($state -match 'enabled:\s*true') {
            Write-Step "The Print Service operational log is already enabled."
            return
        }
        & wevtutil sl $log /e:true /ms:8388608 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "wevtutil could not enable $log." }
        Write-Step "Enabled the Print Service operational log (capped at 8 MB) so a printed form that was never captured can be detected."
    }
    catch {
        Write-Warning "Could not enable the Print Service operational log: $($_.Exception.Message.Trim())"
        Write-Warning "  Printing and capture are unaffected. Reconciliation will report itself degraded until this log is on."
        Write-Warning "  To enable it by hand, from an elevated prompt: wevtutil sl `"$log`" /e:true /ms:8388608"
    }
}

function Remove-OneQueue {
    param([string] $Name, [string] $Path)

    $printer = Get-Printer -Name $Name -ErrorAction SilentlyContinue
    if ($printer) {
        Invoke-PrinterStep "Removing the printer queue $Name" { Remove-Printer -Name $Name }
        Write-Step "Removed the printer queue $Name."
    }
    else {
        Write-Step "No printer named $Name. Nothing to remove."
    }

    if (-not $Path) { return }

    <#
        THE PORT OFTEN CANNOT BE REMOVED, AND THAT IS WINDOWS, NOT US.

        Measured on Windows 11 Home (build 26200), 17 September 2026. Both
        documented mechanisms refuse a port whose name is a file path:

            Remove-PrinterPort -Name 'C:\...\aobprinter-out.pdf'
            Get-PrinterPort -Name '...' | Remove-PrinterPort     (-InputObject)

        Both answer: "Names may not contain ',' or '\' characters." The
        PrintManagement cmdlets validate the name as a printer/server name
        before they reach the spooler, and a file port's name is a path. The
        remaining route is the Win32 DeletePort API or a registry edit under
        Print\Monitors\Local Port\Ports plus a spooler restart, which is
        Carl's call, not a script's.

        WHY IT IS SAFE TO LEAVE. An orphaned file port with no queue pointing at
        it is inert -- nothing can print to a port with no printer -- and the
        install path finds and reuses it. The uninstall says plainly what it
        could not do rather than reporting success it did not achieve.
    #>
    $port = Get-PrinterPort -Name $Path -ErrorAction SilentlyContinue
    if ($port) {
        try {
            Remove-PrinterPort -Name $Path -ErrorAction Stop
            Write-Step "Removed the printer port $Path."
        }
        catch {
            Write-Step "Could not remove the port at $Path - Windows refuses to name a file-path port:"
            Write-Step "  $($_.Exception.Message.Trim())"
            Write-Step "The queue is gone, so nothing can print to it."
        }
    }
    else {
        Write-Step "No port at $Path. Nothing to remove."
    }
}

if ($Uninstall) {
    <#
        UNINSTALL READS THE MARKER, because the person removing this is not
        necessarily the person who installed it and will not know that the host
        carries six queues. Falling back to the parameters would leave five
        printers behind on a LAN host and report success.
    #>
    $markerPath = Join-Path $DataDir 'install.json'
    $toRemove = @()
    if (Test-Path -LiteralPath $markerPath) {
        $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
        Write-Host "Removing AOBPRINTER $($marker.version) ($($marker.installMode) mode, $($marker.queues.Count) queue(s))"
        foreach ($q in $marker.queues) {
            $known = Get-Printer -Name $q.name -ErrorAction SilentlyContinue
            $toRemove += [pscustomobject]@{ Name = $q.name; SpoolFile = $(if ($known) { $known.PortName } else { $null }) }
        }
    }
    <#
        NO MARKER MEANS REMOVE NOTHING, UNLESS A HUMAN NAMED SOMETHING.

        This fell back to Resolve-QueueList, which falls back to the DEFAULT
        -PrinterName. Measured here on 17 September 2026: running -Uninstall a
        second time, after the marker was already gone, deleted the practice's
        real AOBPRINTER queue and its port -- a queue this invocation had never
        installed and had no record of. A mistyped -DataDir would do the same.

        A default parameter is not an instruction. An explicit one is: if
        somebody passes -Queues or -PrinterName they have named what they mean,
        and $PSBoundParameters is how this script can tell the difference
        between a name that was typed and a name that was merely defaulted.
    #>
    elseif ($PSBoundParameters.ContainsKey('Queues') -or $PSBoundParameters.ContainsKey('PrinterName')) {
        Write-Host "No install marker at $markerPath. Removing only what was named on the command line."
        foreach ($q in @(Resolve-QueueList)) { $toRemove += $q }
    }
    else {
        Write-Host "No install marker at $markerPath, and no queue was named on the command line."
        Write-Step "Nothing removed. This script will not guess at a printer to delete from a default value."
        Write-Step "If you know which queues to remove, name them: -Queues @(@{ Name='...'; SpoolFile='...' }) or -PrinterName <name>."
        Write-Host "Done."
        return
    }

    foreach ($q in $toRemove) { Remove-OneQueue -Name $q.Name -Path $q.SpoolFile }

    if (Test-Path -LiteralPath $markerPath) {
        Remove-Item -LiteralPath $markerPath -Force
        Write-Step "Removed the install marker."
    }

    Write-Step "Left $DataDir and its contents alone; a queued form is the practice's, not ours to delete."
    Write-Host "Done."
    return
}

$script:Unshared = @()
$queueList = @(Resolve-QueueList)
$version = Get-PackageVersion

Write-Host "Installing AOBPRINTER $version ($Mode mode, $($queueList.Count) queue(s))"

Assert-VersionAllowed -Version $version

$driver = Get-PrinterDriver -Name $DriverName -ErrorAction SilentlyContinue
if (-not $driver) {
    throw "The '$DriverName' driver is not installed. It ships with Windows 10 and 11; enable the " +
          "'Microsoft Print to PDF' Windows feature and run this again. This script installs no driver of its own."
}

foreach ($queue in $queueList) {
    $name = $queue.Name
    $path = $queue.SpoolFile
    $folder = Split-Path -Parent $path
    Write-Host ""
    Write-Host "  $name  ($($queue.Label))"

    if (-not (Test-Path -LiteralPath $folder)) {
        New-Item -ItemType Directory -Path $folder -Force | Out-Null
        Write-Step "Created $folder."
    }

    $port = Get-PrinterPort -Name $path -ErrorAction SilentlyContinue
    if (-not $port) {
        Invoke-PrinterStep "Creating the printer port for $name" { Add-PrinterPort -Name $path }
        Write-Step "Created the file port at $path."
    }
    else {
        Write-Step "The port at $path already exists."
    }

    $printer = Get-Printer -Name $name -ErrorAction SilentlyContinue
    if (-not $printer) {
        Invoke-PrinterStep "Creating the printer queue $name" { Add-Printer -Name $name -DriverName $DriverName -PortName $path }
        Write-Step "Created the printer queue."
    }
    elseif ($printer.PortName -ne $path -or $printer.DriverName -ne $DriverName) {
        # An existing queue pointing somewhere else is the one case worth
        # correcting: left alone, the practice prints into a file nothing watches.
        Invoke-PrinterStep "Repointing $name" { Set-Printer -Name $name -DriverName $DriverName -PortName $path }
        Write-Step "The printer existed but pointed elsewhere; repointed it at $path."
    }
    else {
        Write-Step "The printer already exists and is correctly configured."
    }

    $printer = Get-Printer -Name $name

    <#
        THE SPOOLER MUST NOT KEEP ITS OWN COPY.

        AOBPRINTER's outbox encrypts a form while it waits and deletes it the
        moment it is no longer needed (D-2026-09-17-01). None of that matters if
        Windows' own spooler is quietly holding a second, plaintext copy of every
        job under "Keep printed documents" -- a setting meant for reprinting from
        the queue, which on a queue that exists only to feed AOBPRINTER is an
        unmanaged duplicate of exactly the PII the retention feature exists to
        stop accumulating. Asserted on every install, not just a fresh one: local
        IT policy or a prior manual change could have turned it back on.
    #>
    if ($printer.KeepPrintedJobs) {
        Invoke-PrinterStep "Disabling keep-printed-documents on $name" { Set-Printer -Name $name -KeepPrintedJobs $false }
        Write-Step 'Disabled "keep printed documents" - the spooler holds no copy of a form.'
        $printer = Get-Printer -Name $name
    }
    else {
        Write-Step '"Keep printed documents" is already off.'
    }

    if ($Mode -eq 'Lan') {
        <#
            SHARING USUALLY NEEDS ELEVATION, AND A FAILED SHARE MUST NOT BE
            REPORTED AS A SHARE.

            Measured here on 17 September 2026: unelevated, Set-Printer -Shared
            fails with 0x80070bce and the CIM error is non-terminating, so a
            script that prints its success line next announces a share that did
            not happen. A technician reads "Shared as \\HOST\QUEUE", walks to a
            workstation, and finds nothing to connect to.

            So: attempt, then READ IT BACK, and let the summary carry the truth.
            The install is not failed over it -- the queue works locally and the
            watcher will still claim from it -- but LAN mode without a share is
            not the thing that was asked for, and the last line of output says
            so instead of the middle of a scroll.
        #>
        if (-not $printer.Shared -or $printer.ShareName -ne $name) {
            try {
                Set-Printer -Name $name -Shared $true -ShareName $name -ErrorAction Stop
            }
            catch {
                Write-Step "Could not share the queue: $($_.Exception.Message.Trim())"
            }
            $printer = Get-Printer -Name $name
        }

        if ($printer.Shared -and $printer.ShareName -eq $name) {
            Write-Step "Shared as \\$env:COMPUTERNAME\$name - workstations connect to this; they install nothing."
        }
        else {
            $script:Unshared += $name
            Write-Warning "  $name is NOT shared, so no workstation can print to it. Re-run from an elevated PowerShell."
        }
    }
    elseif ($printer.Shared) {
        # Single mode means single machine. A queue left shared from a previous
        # LAN install would quietly accept jobs from workstations whose forms
        # this host is no longer expected to be handling.
        Invoke-PrinterStep "Unsharing $name" { Set-Printer -Name $name -Shared $false }
        Write-Step "Unshared the queue (Single mode)."
    }
}

Write-Host ""
Enable-PrintServiceLog
Write-InstallMarker -Version $version -QueueList $queueList

Write-Host ""
Write-Host "Done. AOBPRINTER $version, $Mode mode."
foreach ($queue in $queueList) {
    Write-Host "  $($queue.Name)  ->  $($queue.SpoolFile)   [$($queue.Label)]"
}
Write-Host ""
if ($Mode -eq 'Lan') {
    if ($script:Unshared.Count -gt 0) {
        Write-Warning "LAN MODE IS INCOMPLETE. These queues are not shared, so no workstation can reach them:"
        foreach ($n in $script:Unshared) { Write-Warning "    $n" }
        Write-Warning "Re-run this script from an elevated PowerShell. Everything else above is done and is not repeated harmfully."
    }
    else {
        Write-Host "  Workstations add the shared queue; nothing is installed on them."
    }
    Write-Host "  The spool stream crosses the practice network - SMB encryption is the practice's requirement."
}
Write-Host "  The watcher is a separate install and reads every spool file above."
Write-Host "  It needs $DataDir\aobprinter.config.json with this practice's id, endpoint and queues."
