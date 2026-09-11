# Helpful scripts

Things that are awkward to reconstruct from memory at the moment you need them,
usually because something is broken and the ordinary route through the console
is the thing that is broken.

Everything here talks to the **sandbox** on localhost. Ports come from
`docker-compose.yml`: Keycloak on 21024, MailHog on 21026, Postgres on 21020,
core on 21001, the console on 3100.

---

## Send a passkey enrolment link to an account that cannot sign in

**The symptom.** Signing in gives *"Cannot login, credential setup required"*,
or the login page asks for a password nobody ever set.

**Why the login page cannot help.** The realm's browser flow requires a WebAuthn
passkey and has the password form DISABLED. An account holding no credential at
all therefore reaches a step it cannot satisfy, and there is no field on that
page that would accept anything. Setting a *required action* does not fix it
either — required actions run **after** authentication, and this account cannot
get that far.

The way in is an **action token sent by email**, which bypasses the login flow
rather than satisfying it.

```powershell
.\scripts\send-enrolment-link.ps1 -Username admin.821709fb
```

Or as a one-liner, if you would rather not trust a script you have not read:

```powershell
$t=(Invoke-RestMethod -Method Post -Uri "http://localhost:21024/realms/master/protocol/openid-connect/token" -Body @{client_id='admin-cli';username='admin';password='admin';grant_type='password'}).access_token; $h=@{Authorization="Bearer $t"}; $u=(Invoke-RestMethod -Uri "http://localhost:21024/admin/realms/aobplatform/users?username=admin.821709fb" -Headers $h)[0].id; Invoke-RestMethod -Method Put -Uri "http://localhost:21024/admin/realms/aobplatform/users/$u/execute-actions-email?client_id=web&redirect_uri=http%3A%2F%2Flocalhost%3A3100&lifespan=3600" -Headers $h -ContentType 'application/json' -Body '["webauthn-register-passwordless"]'
```

The mail lands in MailHog: <http://localhost:21026>. Subject *"Set up your
AoBPlatform sign-in"*. The link lasts an hour.

> In production this is what the console's **Send invite** button does. The
> script exists for the case where the account you would sign in with to press
> that button is the broken one.

---

## See what has actually been sent

MailHog's UI is at <http://localhost:21026>, but when you only want to know
whether something went out:

```powershell
(Invoke-RestMethod "http://localhost:21026/api/v2/messages?limit=10").items | ForEach-Object { "{0}  ->  {1}" -f $_.Content.Headers.Subject[0], $_.Content.Headers.To[0] }
```

An empty result is a real answer. Several flows record that a message was sent
without sending one, and this is how you tell the two apart.

---

## Who exists in the realm, and can they sign in

The question behind most login problems: does the account hold a credential.
`creds=NONE` means it cannot sign in, whatever the console shows.

```powershell
$t=(Invoke-RestMethod -Method Post -Uri "http://localhost:21024/realms/master/protocol/openid-connect/token" -Body @{client_id='admin-cli';username='admin';password='admin';grant_type='password'}).access_token; $h=@{Authorization="Bearer $t"}; Invoke-RestMethod -Uri "http://localhost:21024/admin/realms/aobplatform/users?max=100" -Headers $h | ForEach-Object { $c=(Invoke-RestMethod -Uri "http://localhost:21024/admin/realms/aobplatform/users/$($_.id)/credentials" -Headers $h); "{0,-32} {1,-38} creds={2}" -f $_.username, $_.email, (@($c.type) -join ',' | ForEach-Object { if ($_) { $_ } else { 'NONE' } }) }
```

---

## Run a migration

Prisma runs as the migration role, not the application role — the application
role cannot bypass RLS and a migration needs to.

```powershell
$env:DATABASE_URL="postgresql://aobplatform:aobplatform@127.0.0.1:21020/aobplatform?schema=core"; npx prisma migrate deploy --schema apps/core/prisma/schema.prisma
```

Then regenerate the client, or the new columns will not exist in TypeScript:

```powershell
npx prisma generate --schema apps/core/prisma/schema.prisma
```

---

## Re-import the realm from scratch

**Read this before editing `realm-export.json` and expecting anything to
happen.** `--import-realm` imports only when the realm does not already exist.
Keycloak keeps its state in the `keycloak` **Postgres database**, not in a
container layer or a named volume, so restarting or recreating the container
changes nothing. An edit to the export reaches a running realm only if you
either re-import, or make the same change through the admin API.

To actually re-import — **this deletes every account and passkey in the realm**,
so everybody enrols again afterwards. The superuser is `aobplatform`, not
`postgres`; `POSTGRES_USER` in `docker-compose.yml` is what makes it so:

```powershell
docker compose stop keycloak; docker exec aobplatform-postgres psql -U aobplatform -d postgres -c "DROP DATABASE keycloak;"; docker exec aobplatform-postgres psql -U aobplatform -d postgres -c "CREATE DATABASE keycloak OWNER keycloak;"; docker compose start keycloak
```

Watch it come back up before trusting it:

```powershell
docker compose logs -f keycloak
```

The export at `infra/keycloak/realm-export.json` is the source of truth, and
`apps/core/test/realm-config.e2e-spec.ts` checks the two parts of it that have
silently broken before: the default client scopes, and the browser flow binding.
Both were wrong at once, and neither showed up as anything but an unexplained
403 and a password prompt for an account that has no password.
