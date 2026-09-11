-- The enrolment emails we have already sent, written down after the fact.
--
-- Keycloak sends these over its own SMTP, because the link inside is an action
-- token only Keycloak can mint -- so they never touched our outbound queue, and
-- "what we have sent you" showed a practitioner nothing while the message sat
-- in their inbox. A page telling somebody we had sent them nothing, minutes
-- after emailing them.
--
-- The code now records each send as it happens. This backfills the ones that
-- went out before it did, so the page is not silent about messages people have
-- already received and may ring up about.
--
-- DATED FROM `invitedAt`, the moment we actually sent it. Dating them today
-- would put a message somebody received last week into this week's figures,
-- which is a small lie that a report would then repeat.
--
-- Anchored to the practice that introduced them: the truthful answer to "on
-- whose account did this go out" for an invitation nobody else caused.
INSERT INTO "outbound_items" (
  "id", "practiceId", "channel", "destination", "subjectType", "subjectId",
  "mediaType", "recipientType", "recipientId", "payload", "state", "sentAt",
  "idempotencyKey", "createdAt"
)
SELECT
  gen_random_uuid(),
  p."invitedByPracticeId",
  'email',
  p."email",
  'Practitioner',
  p."id",
  'email',
  'practitioner',
  p."id",
  jsonb_build_object('subject', 'Set up your AoBPlatform sign-in', 'sentBy', 'keycloak', 'backfilled', true),
  'sent',
  p."invitedAt",
  'practitioner-enrolment-backfill:' || p."id",
  p."invitedAt"
FROM "practitioners" p
WHERE p."invitedAt" IS NOT NULL
  AND p."email" IS NOT NULL
  -- Without a practice there is nowhere truthful to anchor it, and attributing
  -- it to an arbitrary one would be worse than leaving it unrecorded.
  AND p."invitedByPracticeId" IS NOT NULL
ON CONFLICT ("practiceId", "idempotencyKey") DO NOTHING;
