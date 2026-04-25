-- CreateEnum
CREATE TYPE "EconomyTransactionReason" AS ENUM (
  'REQUEST_CREATE',
  'REQUEST_VOTE',
  'REQUEST_FILL',
  'REQUEST_UNFILL',
  'REQUEST_REFUND'
);

-- AlterTable: migrate reason column from free-form text to enum
ALTER TABLE "economy_transactions"
  ALTER COLUMN "reason" TYPE "EconomyTransactionReason"
  USING "reason"::"EconomyTransactionReason";

-- AlterTable: add actor + context metadata columns
ALTER TABLE "economy_transactions"
  ADD COLUMN "actorUserId" INTEGER,
  ADD COLUMN "contextType" TEXT;

-- CreateEnum
CREATE TYPE "RequestActionType" AS ENUM (
  'CREATE',
  'ADD_BOUNTY',
  'FILL',
  'UNFILL',
  'DELETE',
  'RESTORE'
);

-- CreateTable: request_actions (full audit trail for all request state changes)
CREATE TABLE "request_actions" (
  "id"        SERIAL       NOT NULL,
  "requestId" INTEGER      NOT NULL,
  "actorId"   INTEGER      NOT NULL,
  "action"    "RequestActionType" NOT NULL,
  "metadata"  JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "request_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: request_fills (fill history — one row per fill event)
CREATE TABLE "request_fills" (
  "id"             SERIAL       NOT NULL,
  "requestId"      INTEGER      NOT NULL,
  "contributionId" INTEGER      NOT NULL,
  "fillerId"       INTEGER      NOT NULL,
  "awardedAmount"  BIGINT       NOT NULL DEFAULT 0,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "request_fills_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "request_actions_requestId_idx" ON "request_actions"("requestId");
CREATE INDEX "request_fills_requestId_idx" ON "request_fills"("requestId");

-- ForeignKey: economy_transactions.actorUserId
ALTER TABLE "economy_transactions"
  ADD CONSTRAINT "economy_transactions_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ForeignKey: request_actions
ALTER TABLE "request_actions"
  ADD CONSTRAINT "request_actions_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "request_actions"
  ADD CONSTRAINT "request_actions_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ForeignKey: request_fills
ALTER TABLE "request_fills"
  ADD CONSTRAINT "request_fills_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "request_fills"
  ADD CONSTRAINT "request_fills_contributionId_fkey"
  FOREIGN KEY ("contributionId") REFERENCES "contributions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "request_fills"
  ADD CONSTRAINT "request_fills_fillerId_fkey"
  FOREIGN KEY ("fillerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
