-- CreateTable
CREATE TABLE "rules" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "complianceWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "violationWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_rules" (
    "id" SERIAL NOT NULL,
    "ruleId" INTEGER NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "complianceWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "violationWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sub_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rules_code_key" ON "rules"("code");

-- CreateIndex
CREATE INDEX "rules_sortOrder_idx" ON "rules"("sortOrder");

-- CreateIndex
CREATE INDEX "sub_rules_ruleId_idx" ON "sub_rules"("ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "sub_rules_ruleId_code_key" ON "sub_rules"("ruleId", "code");

-- AddForeignKey
ALTER TABLE "sub_rules" ADD CONSTRAINT "sub_rules_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

