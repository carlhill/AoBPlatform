-- CreateTable
CREATE TABLE "chain_entry_index" (
    "id" UUID NOT NULL,
    "namespace" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "eventId" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "hash" TEXT NOT NULL,
    "artefactSha256" TEXT,
    "immudbTxId" TEXT NOT NULL,

    CONSTRAINT "chain_entry_index_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chain_entry_index_namespace_subjectId_idx" ON "chain_entry_index"("namespace", "subjectId");

-- CreateIndex
CREATE INDEX "chain_entry_index_namespace_artefactSha256_idx" ON "chain_entry_index"("namespace", "artefactSha256");

-- CreateIndex
CREATE UNIQUE INDEX "chain_entry_index_namespace_seq_key" ON "chain_entry_index"("namespace", "seq");
