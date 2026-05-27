-- CreateTable
CREATE TABLE "dev_seed_runs" (
    "id" TEXT NOT NULL,
    "label" TEXT,
    "mode" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "warnings" JSONB,
    "cleanupStatus" TEXT NOT NULL DEFAULT 'active',
    "reversibilityLevel" TEXT NOT NULL DEFAULT 'full',
    "actorId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dev_seed_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dev_seed_records" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "pk" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dev_seed_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dev_seed_mutations" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "pk" JSONB NOT NULL,
    "mutation" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reversible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dev_seed_mutations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dev_seed_records_runId_idx" ON "dev_seed_records"("runId");

-- CreateIndex
CREATE INDEX "dev_seed_records_entityType_idx" ON "dev_seed_records"("entityType");

-- CreateIndex
CREATE INDEX "dev_seed_mutations_runId_idx" ON "dev_seed_mutations"("runId");

-- CreateIndex
CREATE INDEX "dev_seed_mutations_entityType_idx" ON "dev_seed_mutations"("entityType");

-- AddForeignKey
ALTER TABLE "dev_seed_records" ADD CONSTRAINT "dev_seed_records_runId_fkey" FOREIGN KEY ("runId") REFERENCES "dev_seed_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dev_seed_mutations" ADD CONSTRAINT "dev_seed_mutations_runId_fkey" FOREIGN KEY ("runId") REFERENCES "dev_seed_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
