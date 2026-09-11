-- Notice of departure given OUTSIDE AoBPlatform.
--
-- Recording a past departure used to be refused outright, on the correct
-- reasoning that under reg 65CA(8) the agreements ceased when the practitioner
-- left and backdating a notice does not un-cease them.
--
-- But the refusal did not prevent the departure. It only prevented us knowing
-- about it -- so the platform went on showing a practitioner as ACTIVE at a
-- location they had already left. That is a worse falsehood than the one the
-- rule was guarding against.
--
-- The practice can now attest that notice was given elsewhere: in an
-- employment agreement, by letter, by email outside the platform, or in
-- person. It is stored AS an attestation and never relabelled as our own
-- notice. `noticeAnomaly` records short or late notice so a reader sees it
-- without recomputing.
--
-- All nullable: existing rows had notice through the platform, and must not be
-- retro-labelled with a means nobody chose.

ALTER TABLE "affiliations"
  ADD COLUMN "externalNoticeMeans"      TEXT,
  ADD COLUMN "externalNoticeGivenAt"    TIMESTAMP(3),
  ADD COLUMN "externalNoticeNote"       TEXT,
  ADD COLUMN "externalNoticeAttestedBy" TEXT,
  ADD COLUMN "noticeLeadBusinessDays"   INTEGER,
  ADD COLUMN "noticeAnomaly"            TEXT;

-- Finding departures whose notice was short, late, or attested rather than
-- delivered. This is a compliance read, not a screen read, and it wants to be
-- cheap because it will run over the whole table.
CREATE INDEX "affiliations_notice_anomaly_idx"
  ON "affiliations" ("practiceId")
  WHERE "noticeAnomaly" IS NOT NULL;
