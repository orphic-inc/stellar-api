-- Merge every tag name into its one canonical form (#689, ADR-0047).
--
-- The rule is `normalizeTagName` in `src/modules/tag.ts`: ASCII lowercase; a
-- run of spaces, tabs, `-` or `_` becomes one `.`; anything else outside
-- `[a-z0-9.]` is dropped; repeated dots collapse and edge dots go. The
-- expression between the `normalize:` markers restates it, and
-- `tagNameMigration.integration.ts` runs THAT expression against the TypeScript
-- function, so the two cannot disagree unnoticed.
--
-- One statement, so one transaction, so an integration test can run exactly
-- this SQL. Each row it drops is reported with RAISE NOTICE.
DO $migration$
DECLARE
  r record;
  n integer;
BEGIN
  -- Every raw name in play, with its canonical form.
  CREATE TEMP TABLE _tag_norm ON COMMIT DROP AS
  SELECT raw,
    /* normalize:begin */
    btrim(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            translate(raw, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'),
            '[ \t\n\r\f\v_-]+', '.', 'g'
          ),
          '[^a-z0-9.]', '', 'g'
        ),
        '\.{2,}', '.', 'g'
      ),
      '.'
    )
    /* normalize:end */
    AS norm
  FROM (
    SELECT name AS raw FROM tags
    UNION
    SELECT "badTag" FROM tag_aliases
  ) AS names;

  -- A tag with no usable characters has no canonical form to merge into. It
  -- stays as it is: no write can reach it again, and deleting it would take its
  -- releases' tagging with it.
  FOR r IN
    SELECT t.id, t.name FROM tags t
    JOIN _tag_norm tn ON tn.raw = t.name
    WHERE tn.norm = ''
  LOOP
    RAISE NOTICE 'tag % (%) has no usable characters; left as it is', r.id, r.name;
  END LOOP;

  -- Each group of variants, ranked. The survivor is the row already carrying
  -- the canonical name, else an official row, else the lowest id.
  CREATE TEMP TABLE _tag_merge ON COMMIT DROP AS
  SELECT t.id,
    tn.norm,
    row_number() OVER w AS rank,
    first_value(t.id) OVER w AS survivor_id,
    bool_or(t."isOfficial") OVER (PARTITION BY tn.norm) AS any_official,
    count(*) OVER (PARTITION BY tn.norm) AS group_size
  FROM tags t
  JOIN _tag_norm tn ON tn.raw = t.name
  WHERE tn.norm <> ''
  WINDOW w AS (
    PARTITION BY tn.norm
    ORDER BY (t.name = tn.norm) DESC, t."isOfficial" DESC, t.id
  );

  -- A release or artist carrying two variants keeps the row on the best-ranked
  -- one and loses the other, votes and all: the legacy merge rule. Vote
  -- counters cannot be rebuilt from vote rows, so merging them is not offered.
  DELETE FROM release_tags d
  USING (
    SELECT rt.id,
      row_number() OVER (
        PARTITION BY rt."releaseId", m.survivor_id ORDER BY m.rank
      ) AS pos
    FROM release_tags rt
    JOIN _tag_merge m ON m.id = rt."tagId"
    WHERE m.group_size > 1
  ) k
  WHERE d.id = k.id AND k.pos > 1;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    RAISE NOTICE '% release tag(s) removed as duplicates of a merged tag', n;
  END IF;

  DELETE FROM artist_tags d
  USING (
    SELECT at.id,
      row_number() OVER (
        PARTITION BY at."artistId", m.survivor_id ORDER BY m.rank
      ) AS pos
    FROM artist_tags at
    JOIN _tag_merge m ON m.id = at."tagId"
    WHERE m.group_size > 1
  ) k
  WHERE d.id = k.id AND k.pos > 1;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    RAISE NOTICE '% artist tag(s) removed as duplicates of a merged tag', n;
  END IF;

  -- Everything that pointed at a merged-away variant now points at its survivor.
  UPDATE release_tags SET "tagId" = m.survivor_id
  FROM _tag_merge m
  WHERE release_tags."tagId" = m.id AND m.id <> m.survivor_id;

  UPDATE artist_tags SET "tagId" = m.survivor_id
  FROM _tag_merge m
  WHERE artist_tags."tagId" = m.id AND m.id <> m.survivor_id;

  UPDATE tag_aliases SET "goodTagId" = m.survivor_id
  FROM _tag_merge m
  WHERE tag_aliases."goodTagId" = m.id AND m.id <> m.survivor_id;

  -- Curation is never lost: a group with any official variant stays official.
  UPDATE tags SET "isOfficial" = true
  FROM _tag_merge m
  WHERE tags.id = m.id AND m.id = m.survivor_id
    AND m.any_official AND NOT tags."isOfficial";

  DELETE FROM tags
  USING _tag_merge m
  WHERE tags.id = m.id AND m.id <> m.survivor_id;

  -- Only now is the canonical name free for the survivor to take.
  UPDATE tags SET name = m.norm
  FROM _tag_merge m
  WHERE tags.id = m.id AND m.id = m.survivor_id AND tags.name <> m.norm;

  -- `occurrences` counts the releases carrying a tag, so a merged group is
  -- recounted rather than summed: summing double-counts every release that
  -- carried two variants.
  UPDATE tags SET occurrences = (
    SELECT count(*) FROM release_tags rt WHERE rt."tagId" = tags.id
  )
  FROM _tag_merge m
  WHERE tags.id = m.id AND m.id = m.survivor_id AND m.group_size > 1;

  -- Aliases. The resolver looks `badTag` up normalized, so every alias is
  -- normalized too, and first the ones that cannot survive it are removed.
  FOR r IN
    DELETE FROM tag_aliases a
    USING _tag_norm tn
    WHERE tn.raw = a."badTag" AND tn.norm = ''
    RETURNING a.id, a."badTag"
  LOOP
    RAISE NOTICE 'alias % (%) dropped: no usable characters', r.id, r."badTag";
  END LOOP;

  -- An alias onto its own target does nothing once names are normalized.
  FOR r IN
    DELETE FROM tag_aliases a
    USING _tag_norm tn, tags t
    WHERE tn.raw = a."badTag" AND t.id = a."goodTagId" AND tn.norm = t.name
    RETURNING a.id, a."badTag", t.name
  LOOP
    RAISE NOTICE 'alias % (%) dropped: it is now the name of its target %',
      r.id, r."badTag", r.name;
  END LOOP;

  -- An official tag may not be aliased away (ADR-0045 §3), and normalizing an
  -- alias can land it on one. The curation stands and the alias goes.
  FOR r IN
    DELETE FROM tag_aliases a
    USING _tag_norm tn, tags t
    WHERE tn.raw = a."badTag" AND t.name = tn.norm AND t."isOfficial"
    RETURNING a.id, a."badTag", t.name
  LOOP
    RAISE NOTICE 'alias % (%) dropped: it would alias away official tag %',
      r.id, r."badTag", r.name;
  END LOOP;

  -- Two aliases that normalize alike: the older one stands.
  FOR r IN
    DELETE FROM tag_aliases a
    USING (
      SELECT a2.id, tn.norm,
        row_number() OVER (PARTITION BY tn.norm ORDER BY a2.id) AS pos
      FROM tag_aliases a2
      JOIN _tag_norm tn ON tn.raw = a2."badTag"
    ) k
    WHERE a.id = k.id AND k.pos > 1
    RETURNING a.id, a."badTag", k.norm
  LOOP
    RAISE NOTICE 'alias % (%) dropped: an older alias already claims %',
      r.id, r."badTag", r.norm;
  END LOOP;

  UPDATE tag_aliases SET "badTag" = tn.norm
  FROM _tag_norm tn
  WHERE tn.raw = tag_aliases."badTag" AND tag_aliases."badTag" <> tn.norm;
END
$migration$;
