-- Consultation complete: a telehealth session can end as `went_ahead` after the patient agreed
-- (Carl, 12 Oct 2026, DECISIONS.md D-2026-10-12-03 item 6). Copied from TELEHEALTH_SESSION_STATES
-- in packages/domain/src/telehealth.ts; change both together.
ALTER TABLE "telehealth_sessions" DROP CONSTRAINT IF EXISTS "telehealth_sessions_state_check";
ALTER TABLE "telehealth_sessions" ADD CONSTRAINT "telehealth_sessions_state_check"
  CHECK ("state" IN ('opened', 'code_checked', 'agreed', 'not_done', 'did_not_proceed', 'went_ahead'));
