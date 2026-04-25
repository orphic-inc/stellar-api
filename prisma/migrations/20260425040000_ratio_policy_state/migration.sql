-- RatioPolicyStatus enum
CREATE TYPE "RatioPolicyStatus" AS ENUM ('OK', 'WATCH', 'LEECH_DISABLED');

-- Ratio policy state table (one row per user, created on first evaluation)
CREATE TABLE "ratio_policy_states" (
    "userId"                 INTEGER           NOT NULL,
    "status"                 "RatioPolicyStatus" NOT NULL DEFAULT 'OK',
    "watchStartedAt"         TIMESTAMP(3),
    "watchExpiresAt"         TIMESTAMP(3),
    "downloadedAtWatchStart" BIGINT,
    "leechDisabledAt"        TIMESTAMP(3),
    "lastEvaluatedAt"        TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ratio_policy_states_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "ratio_policy_states"
    ADD CONSTRAINT "ratio_policy_states_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
