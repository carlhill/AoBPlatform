/**
 * Prints the most recent passkey-enrolment link from Mailhog.
 *
 *   node infra/keycloak/latest-invite-link.mjs
 *
 * Local dev convenience only: in a real deployment the practitioner receives
 * the email and nobody else can read it. Mailhog exists so you can follow the
 * link yourself without a mailbox.
 */
const MAILHOG = process.env.MAILHOG_URL ?? 'http://localhost:21026';

const res = await fetch(`${MAILHOG}/api/v2/messages`);
if (!res.ok) {
  console.error(`Mailhog unreachable at ${MAILHOG} (${res.status}). Is the stack up?`);
  process.exit(1);
}
const { items = [] } = await res.json();
if (items.length === 0) {
  console.error('No messages in Mailhog. Send an invitation first:');
  console.error('  POST /identity/providers/{providerId}/invite  {"email":"..."}');
  process.exit(1);
}

// Quoted-printable: soft line breaks are "=" + CRLF, and "=" itself is "=3D".
const decode = (body) => body.replace(/=\r?\n/g, '').replace(/=3D/g, '=');

for (const item of items) {
  const body = decode(item.Content?.Body ?? '');
  const link = body.match(/http:\/\/localhost:21024[^"'<\s]+/)?.[0];
  if (link) {
    const to = item.To?.[0];
    console.error(`(most recent invitation, to ${to?.Mailbox}@${to?.Domain})`);
    console.log(link);
    process.exit(0);
  }
}
console.error('Messages found, but none contained an enrolment link.');
process.exit(1);
