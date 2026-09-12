-- THE NUMBER ON THE CARD IN THE PATIENT'S HAND (QUEUE-TICKETS.md; Carl, 12
-- September 2026: "we need to have a fillin for the practice to enter their
-- queue_id -- why? because some practices have a manual card system. The
-- patient on going to the practice, takes a card with a number and reception
-- will call the number when the number is next in the manual list.").
--
-- WHY IT IS ON THE ARRIVAL. It is not a particular of the agreement, must
-- never be rendered onto an artefact, and putting it on the agreement would
-- drag it through supersession -- replacing who signs does not hand the
-- patient a new card (QUEUE-TICKETS.md section 3). It is also not on the
-- tablet session: the number exists from the moment the patient walks in,
-- before any push, and survives a recall and a re-send.
--
-- IT IS NOT AN IDENTITY IDENTIFIER (hard rule 1, REQ-VER-02). The approved set
-- is name, date of birth, gender, address, patient record number and IHI, and
-- it is non-configurable. Nothing verifies by this column, no verification log
-- records it, and it never reaches a rendered agreement.
--
-- THREE SOURCES IN PRECEDENCE ORDER (D-2026-09-12-18): the practice's own card
-- box, then a number their software sent, then one the platform allocated
-- because there was neither. The source is stored because "A12, off their card
-- box" and "we made this up" are different facts.
--
-- Idempotent (DEV-LOOP.md): a migration that only works once passes in
-- development and then breaks `prisma migrate deploy` on the next start.
-- Reversible by
--   ALTER TABLE "arrivals" DROP COLUMN IF EXISTS "queueTicket";
--   ALTER TABLE "arrivals" DROP COLUMN IF EXISTS "queueTicketSource";
--   ALTER TABLE "practices" DROP COLUMN IF EXISTS "usesQueueTickets";
-- -- all three are new, nothing read them before this migration, and their
-- defaults are today's behaviour exactly (no tickets anywhere).
ALTER TABLE "arrivals" ADD COLUMN IF NOT EXISTS "queueTicket" TEXT;
ALTER TABLE "arrivals" ADD COLUMN IF NOT EXISTS "queueTicketSource" TEXT;

-- ONLY WHERE A PRACTICE USES CARDS (QUEUE-TICKETS.md section 4). Default off,
-- and when it is off no ticket is allocated and no surface renders one -- an
-- extra box on a page whose whole purpose is being learnable on day one is
-- precisely the wrong direction (FRONT-DESK-PAGE.md section 4).
ALTER TABLE "practices" ADD COLUMN IF NOT EXISTS "usesQueueTickets" BOOLEAN NOT NULL DEFAULT false;

-- THE CHECK IS DERIVED FROM THE DOMAIN LIST, not from a second literal
-- somebody has to remember to keep in step: these three are
-- `QUEUE_TICKET_SOURCES` in packages/domain/src/queue-ticket.ts. A fourth
-- source is a domain change AND a migration, deliberately -- the database is
-- the last place that can stop a value nobody wrote code for (the same rule
-- the visit-state and copy-link CHECKs follow).
ALTER TABLE "arrivals" DROP CONSTRAINT IF EXISTS "arrivals_ticket_source_check";
ALTER TABLE "arrivals" ADD CONSTRAINT "arrivals_ticket_source_check"
  CHECK ("queueTicketSource" IS NULL
         OR "queueTicketSource" IN ('practice_card', 'practice_software', 'allocated'));

-- A NUMBER WITH NO PROVENANCE IS HALF A FACT, and a provenance with no number
-- is none at all. The two are written together or not at all, so nothing can
-- later read a ticket and be unable to say where it came from.
ALTER TABLE "arrivals" DROP CONSTRAINT IF EXISTS "arrivals_ticket_source_with_ticket";
ALTER TABLE "arrivals" ADD CONSTRAINT "arrivals_ticket_source_with_ticket"
  CHECK (("queueTicket" IS NULL) = ("queueTicketSource" IS NULL));

-- SHORT, AND THE DATABASE SAYS SO. Practices use `A12` and `012` as well as
-- `12`; eight characters is past every card box anybody has described and
-- short enough that this can never quietly become a field somebody stores a
-- name, a note or an identifier in.
ALTER TABLE "arrivals" DROP CONSTRAINT IF EXISTS "arrivals_ticket_is_short";
ALTER TABLE "arrivals" ADD CONSTRAINT "arrivals_ticket_is_short"
  CHECK ("queueTicket" IS NULL OR (length("queueTicket") BETWEEN 1 AND 8));

-- "Is anybody else holding number 12 today?" -- the duplicate WARNING of
-- section 5.3, which never refuses -- and the allocation of the next free
-- number. Practice-scoped and read with the arrival column, because a ticket
-- means nothing outside its practice and its day (section 5.4). Deliberately
-- NOT unique: a card box that wraps around is an ordinary morning.
CREATE INDEX IF NOT EXISTS "arrivals_practiceId_queueTicket_arrivedAt_idx"
  ON "arrivals" ("practiceId", "queueTicket", "arrivedAt");
