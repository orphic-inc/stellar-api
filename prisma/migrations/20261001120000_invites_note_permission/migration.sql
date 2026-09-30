-- #851: `invites_note` gates the staff note on an invite. Before it existed,
-- anyone could write one, so a rank that already moderates invites keeps the
-- ability. Data only; no schema change.
UPDATE "user_ranks"
SET "permissions" = "permissions" || '{"invites_note": true}'::jsonb
WHERE "permissions" @> '{"invites_manage": true}'::jsonb;
