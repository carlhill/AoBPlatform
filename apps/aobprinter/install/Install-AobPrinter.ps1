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

    WHAT IT DOES NOT DO. It does not touch the default printer, it does not share
    the queue on the network, and it does not install the watcher service. A
    practice that runs this and nothing else has a printer that quietly writes
    PDFs to a folder, which is harmless.

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

.NOTES
    Verified on Windows 11 Home (build 26200), 17 September 2026, WITHOUT elevation:
    Add-Printer, Remove-Printer and Add-PrinterPort all succeed as an ordinary
    user there. Group policy may still require elevation; see the note below.
#>
[CmdletBinding()]
param(
    [string] $PrinterName = 'AOBPRINTER',
    [string] $SpoolFile = 'C:\ProgramData\AoBPlatform\spool\aobprinter-out.pdf',
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

if ($Uninstall) {
    Write-Host "Removing $PrinterName"

    $printer = Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue
    if ($printer) {
        Invoke-PrinterStep 'Removing the printer queue' { Remove-Printer -Name $PrinterName }
        Write-Step "Removed the printer queue."
    }
    else {
        Write-Step "No printer named $PrinterName. Nothing to remove."
    }

    <#
        THE PORT OFTEN CANNOT BE REMOVED, AND THAT IS WINDOWS, NOT US.

        Measured on Windows 11 Home (build 26200), 17 September 2026. Both
        documented mechanisms refuse a port whose name is a file path:

            Remove-PrinterPort -Name 'C:\...\aobprinter-out.pdf'
            Get-PrinterPort -Name '...' | Remove-PrinterPort     (-InputObject)

        Both answer: "The specified server does not exist, or the server or
        printer name is invalid. Names may not contain ',' or '\' characters."
        The PrintManagement cmdlets validate the name as a printer/server name
        before they reach the spooler, and a file port's name is a path. The
        remaining route is the Win32 DeletePort API or editing
        HKLM\...\Print\Monitors\Local Port\Ports and restarting the spooler —
        which is a registry edit plus a service restart on a practice's desktop,
        and that is Carl's call, not a script's.

        WHY IT IS SAFE TO LEAVE. An orphaned file port with no queue pointing at
        it is inert: nothing can print to a port with no printer, and the
        reinstall path above finds the existing port and reuses it, which is why
        the installer was written to be idempotent about it in the first place.
        The uninstall says plainly what it could not do rather than reporting
        success it did not achieve.
    #>
    $port = Get-PrinterPort -Name $SpoolFile -ErrorAction SilentlyContinue
    if ($port) {
        try {
            Remove-PrinterPort -Name $SpoolFile -ErrorAction Stop
            Write-Step "Removed the printer port."
        }
        catch {
            Write-Step "Could not remove the port at $SpoolFile - Windows refuses to name a file-path port:"
            Write-Step "  $($_.Exception.Message.Trim())"
            Write-Step "The queue is gone, so nothing can print to it. Removing the port itself needs a"
            Write-Step "registry edit under Print\Monitors\Local Port\Ports and a spooler restart."
        }
    }
    else {
        Write-Step "No port at $SpoolFile. Nothing to remove."
    }

    Write-Step "Left $SpoolFolder and its contents alone; a queued form is the practice's, not ours to delete."
    Write-Host "Done."
    return
}

Write-Host "Installing $PrinterName"

if (-not (Test-Path -LiteralPath $SpoolFolder)) {
    New-Item -ItemType Directory -Path $SpoolFolder -Force | Out-Null
    Write-Step "Created $SpoolFolder."
}
else {
    Write-Step "$SpoolFolder already exists."
}

$driver = Get-PrinterDriver -Name $DriverName -ErrorAction SilentlyContinue
if (-not $driver) {
    throw "The '$DriverName' driver is not installed. It ships with Windows 10 and 11; enable the " +
          "'Microsoft Print to PDF' Windows feature and run this again. This script installs no driver of its own."
}

$port = Get-PrinterPort -Name $SpoolFile -ErrorAction SilentlyContinue
if (-not $port) {
    Invoke-PrinterStep 'Creating the printer port' { Add-PrinterPort -Name $SpoolFile }
    Write-Step "Created the file port at $SpoolFile."
}
else {
    Write-Step "The port at $SpoolFile already exists."
}

$printer = Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue
if (-not $printer) {
    Invoke-PrinterStep 'Creating the printer queue' { Add-Printer -Name $PrinterName -DriverName $DriverName -PortName $SpoolFile }
    Write-Step "Created the printer queue."
}
elseif ($printer.PortName -ne $SpoolFile -or $printer.DriverName -ne $DriverName) {
    # An existing queue pointing somewhere else is the one case worth correcting:
    # left alone, the practice would print into a file nothing is watching.
    Invoke-PrinterStep 'Repointing the printer' { Set-Printer -Name $PrinterName -DriverName $DriverName -PortName $SpoolFile }
    Write-Step "The printer existed but pointed elsewhere; repointed it at $SpoolFile."
}
else {
    Write-Step "The printer already exists and is correctly configured."
}

$printer = Get-Printer -Name $PrinterName

<#
    THE SPOOLER MUST NOT KEEP ITS OWN COPY.

    AOBPRINTER's outbox (`src/outbox.ts`, `src/retention.ts`) encrypts a form
    while it waits and deletes it the moment it is no longer needed -- that is
    the whole point of the local-retention feature. None of that matters if
    Windows' own print spooler is quietly holding a second, plaintext copy of
    every job under "Keep printed documents": a setting meant for reprinting
    from the queue, which on a queue that exists only to feed AOBPRINTER is a
    silent, unmanaged duplicate of exactly the PII this feature exists to stop
    accumulating. Asserted on every install, not just a fresh one, because a
    practice's local IT policy or a prior manual change could have turned it
    back on.
#>
if ($printer.KeepPrintedJobs) {
    Invoke-PrinterStep 'Disabling "keep printed documents"' { Set-Printer -Name $PrinterName -KeepPrintedJobs $false }
    Write-Step 'Disabled "keep printed documents" on the queue -- the spooler holds no copy of a form.'
    $printer = Get-Printer -Name $PrinterName
}
else {
    Write-Step '"Keep printed documents" is already off.'
}

Write-Host "Done."
Write-Host "  Name   : $($printer.Name)"
Write-Host "  Driver : $($printer.DriverName)"
Write-Host "  Port   : $($printer.PortName)"
Write-Host ""
Write-Host "  The watcher is a separate install and reads $SpoolFile."
Write-Host "  It needs C:\ProgramData\AoBPlatform\aobprinter.config.json with this practice's id and endpoint."
