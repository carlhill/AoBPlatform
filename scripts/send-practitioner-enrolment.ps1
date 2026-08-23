# Give a practitioner a way to sign in, and send them the link.
#
# WHAT THE CONSOLE DOES AUTOMATICALLY. Accepting an affiliation issues the
# account -- that is the ceremony, and REQ-PKI-01 says no ceremony, no key.
# This script exists for the people who accepted BEFORE that path existed, and
# for support when a link is lost.
#
# It does exactly what PractitionerAccessService.ensureAccount does:
#   * looks for an existing Keycloak account on that address first, so a
#     practitioner never ends up with two identities
#   * creates a passkey-only account with the `provider` realm role
#   * stamps `practitioner_id` and deliberately NO `practice_id` -- their scope
#     is their live affiliations, and a practice on the token would be arbitrary
#     the moment they work at two
#   * writes keycloakUserId back, so the platform knows they have a sign-in
#
# Last updated: 22 August 2026

param(
  [Parameter(Mandatory = $true)][string]$Email,
  [string]$Keycloak = 'http://localhost:21024',
  [string]$Realm = 'aobplatform',
  [string]$Console = 'http://localhost:3100',
  [string]$PgContainer = 'aobplatform-postgres',
  [string]$PgUser = 'aobplatform',
  [string]$PgDatabase = 'aobplatform'
)

$ErrorActionPreference = 'Stop'

function Invoke-PsqlFile([string]$Sql) {
  # Via a file so nothing has to survive shell argument quoting. Quoted
  # identifiers ("givenNames") are the reason: passed as an argument the quotes
  # are stripped, the identifier folds to lowercase, and the column vanishes.
  $tmp = [System.IO.Path]::GetTempFileName()
  try {
    Set-Content -Path $tmp -Value $Sql -Encoding utf8
    docker cp $tmp "${PgContainer}:/tmp/q.sql" | Out-Null
    $out = docker exec $PgContainer psql -U $PgUser -d $PgDatabase -A -t -F '|' -f /tmp/q.sql
    if ($LASTEXITCODE -ne 0) { throw "psql failed: $out" }
    return ($out | Where-Object { $_.Trim() } | Select-Object -Last 1).Trim()
  } finally {
    Remove-Item $tmp -ErrorAction SilentlyContinue
  }
}

# The practitioner must already exist. This script gives an existing person a
# sign-in; it does not invent one.
# PASSED AS A FILE, not as an argument. PowerShell's doubled quotes survive the
# string but not the trip through `docker exec`, which strips them before
# Postgres sees the identifier — so "givenNames" arrived unquoted, was folded to
# lowercase, and the column "did not exist". A file has no quoting to lose.
$row = Invoke-PsqlFile "SELECT id, ""givenNames"", ""familyName"", COALESCE(""deregisteredAt""::text,'') FROM core.practitioners WHERE lower(email) = lower('$Email') LIMIT 1;"
if (-not $row) { throw "No practitioner with the address $Email." }

# id | givenNames | familyName | deregisteredAt — four columns, so four indices.
# Reading the family name as the deregistration date told both practitioners
# they were deregistered, which is the failure that looks most like a real one.
$parts = $row -split '\|'
$practitionerId = $parts[0]
$name = "$($parts[1]) $($parts[2])".Trim()
if ($parts.Length -gt 3 -and $parts[3].Trim()) {
  throw "$name is recorded as deregistered. A deregistered practitioner does not get a way in."
}

Write-Host "Practitioner: $name ($practitionerId)"

$tokenBody = @{ client_id = 'admin-cli'; username = 'admin'; password = 'admin'; grant_type = 'password' }
$token = (Invoke-RestMethod -Method Post -Uri "$Keycloak/realms/master/protocol/openid-connect/token" -Body $tokenBody).access_token
$headers = @{ Authorization = "Bearer $token" }

# LOOK BEFORE CREATING. Keycloak enforces one email per realm so a second
# create would fail anyway -- but the reason to look is that adopting the
# existing account keeps ONE identity for the person.
$existing = Invoke-RestMethod -Uri "$Keycloak/admin/realms/$Realm/users?email=$([System.Uri]::EscapeDataString($Email))&exact=true" -Headers $headers
if ($existing) {
  $userId = $existing[0].id
  Write-Host "Existing account adopted: $userId"
} else {
  $given, $family = ($name -split ' ', 2)
  $body = @{
    username      = $Email
    email         = $Email
    firstName     = $given
    lastName      = if ($family) { $family } else { $given }
    enabled       = $true
    emailVerified = $true
    # practitioner_id and NOT practice_id: their scope is their affiliations.
    attributes    = @{ practitioner_id = @($practitionerId) }
  } | ConvertTo-Json -Depth 5

  Invoke-RestMethod -Method Post -Uri "$Keycloak/admin/realms/$Realm/users" -Headers $headers -ContentType 'application/json' -Body $body | Out-Null
  $created = Invoke-RestMethod -Uri "$Keycloak/admin/realms/$Realm/users?email=$([System.Uri]::EscapeDataString($Email))&exact=true" -Headers $headers
  $userId = $created[0].id
  Write-Host "Account created: $userId"

  $role = Invoke-RestMethod -Uri "$Keycloak/admin/realms/$Realm/roles/provider" -Headers $headers
  $roleBody = ConvertTo-Json @(@{ id = $role.id; name = $role.name })
  Invoke-RestMethod -Method Post -Uri "$Keycloak/admin/realms/$Realm/users/$userId/role-mappings/realm" -Headers $headers -ContentType 'application/json' -Body $roleBody | Out-Null
  Write-Host "Realm role 'provider' granted."
}

$redirect = [System.Uri]::EscapeDataString($Console)
$uri = "$Keycloak/admin/realms/$Realm/users/$userId/execute-actions-email?client_id=web&redirect_uri=$redirect&lifespan=3600"
Invoke-RestMethod -Method Put -Uri $uri -Headers $headers -ContentType 'application/json' -Body '["webauthn-register-passwordless"]' | Out-Null

Invoke-PsqlFile "UPDATE core.practitioners SET ""keycloakUserId"" = '$userId', ""invitedAt"" = now() WHERE id = '$practitionerId';" | Out-Null

Write-Host ""
Write-Host "Enrolment link sent to $Email. It lasts an hour."
Write-Host "In the sandbox it lands in MailHog: http://localhost:21026"
