# Send a passkey enrolment link to a Keycloak account that cannot sign in.
#
# WHEN YOU NEED THIS. An account with no credential cannot be repaired from the
# login screen. The browser flow reaches "WebAuthn Passwordless Authenticator",
# finds nothing enrolled, and stops with "Cannot login, credential setup
# required" -- there is no field on that page that would accept anything,
# because the account holds no password and never will.
#
# The way in is an ACTION TOKEN sent by email, which bypasses the login flow
# rather than satisfying it. That is what this does. It is the same call the
# console's "Send invite" makes; this is the version for when you cannot reach
# the console because the account you would sign in with is the broken one.
#
# Last updated: 22 August 2026

param(
  [Parameter(Mandatory = $true)][string]$Username,
  [string]$Keycloak = 'http://localhost:21024',
  [string]$Realm = 'aobplatform',
  [string]$Console = 'http://localhost:3100',
  # An hour. Long enough to walk away from the desk, short enough that a link
  # sitting in an inbox is not a standing credential.
  [int]$LifespanSeconds = 3600
)

$ErrorActionPreference = 'Stop'

# The master-realm admin. Still admin/admin in docker-compose, which is fine
# for a sandbox and is tracked in TODO.md as the most privileged credential we
# ship.
$tokenBody = @{ client_id = 'admin-cli'; username = 'admin'; password = 'admin'; grant_type = 'password' }
$token = (Invoke-RestMethod -Method Post -Uri "$Keycloak/realms/master/protocol/openid-connect/token" -Body $tokenBody).access_token
$headers = @{ Authorization = "Bearer $token" }

$users = Invoke-RestMethod -Uri "$Keycloak/admin/realms/$Realm/users?username=$Username" -Headers $headers
if (-not $users) { throw "No user '$Username' in realm '$Realm'." }
$userId = $users[0].id
$email = $users[0].email
if (-not $email) { throw "'$Username' has no email address, so there is nowhere to send the link." }

$redirect = [System.Uri]::EscapeDataString($Console)
$uri = "$Keycloak/admin/realms/$Realm/users/$userId/execute-actions-email?client_id=web&redirect_uri=$redirect&lifespan=$LifespanSeconds"
Invoke-RestMethod -Method Put -Uri $uri -Headers $headers -ContentType 'application/json' -Body '["webauthn-register-passwordless"]' | Out-Null

Write-Host "Enrolment link sent to $email (user $Username)."
Write-Host "In the sandbox it lands in MailHog: http://localhost:21026"
