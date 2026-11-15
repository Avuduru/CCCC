-- ============================================================
-- 001: Repair content_id values written before the ID fix
-- ------------------------------------------------------------
-- Before this fix:
--   * Every book was saved as content_id='manual' (Open Library has no `id`),
--     so all books shared ONE works row.
--   * Exports with no work selected were saved as content_id='manual'
--     (e.g. the placeholder title 'عنوان العمل').
--   * Anime/manga IDs were bare numbers: MAL IDs before the AniList switch
--     (commit bf0aaac, 2026-07-09 04:22 UTC), AniList IDs after it, and MAL
--     IDs again whenever the Jikan fallback answered.
-- New code writes 'mal:<id>' / 'anilist:<id>' and Open Library keys.
--
-- BACK UP BOTH TABLES FIRST (HeidiSQL: right-click DB > Export database as SQL).
-- Run STEP 1 alone and review the output before running STEP 2.
-- ============================================================

-- ── STEP 1 (read-only): what will change ─────────────────────
SELECT id, content_id, content_type, title, rater_count, created_at, updated_at
FROM works
WHERE content_id = 'manual'
   OR (content_type IN ('anime','manga') AND content_id REGEXP '^[0-9]+$')
ORDER BY content_type, created_at;

-- ── STEP 2: apply (single transaction) ───────────────────────
-- Check the cut-off against your deploy time: if the AniList code went
-- live later than the commit, move the timestamp to the real deploy time.
-- Note: created_at is in the DB server's time zone.
START TRANSACTION;

-- Rows first created before the AniList switch hold MAL IDs
UPDATE works SET content_id = CONCAT('mal:', content_id)
WHERE content_type IN ('anime','manga')
  AND content_id REGEXP '^[0-9]+$'
  AND created_at <  '2026-07-09 04:22:04';

-- Rows created after it hold AniList IDs (unless the Jikan fallback answered —
-- not recoverable from the data; compare titles on anilist.co if in doubt)
UPDATE works SET content_id = CONCAT('anilist:', content_id)
WHERE content_type IN ('anime','manga')
  AND content_id REGEXP '^[0-9]+$'
  AND created_at >= '2026-07-09 04:22:04';

-- 'manual' rows merge unrelated works and cannot be split back apart.
-- Deleting the works row also deletes its votes (ON DELETE CASCADE).
DELETE FROM works WHERE content_id = 'manual';

-- Review, then COMMIT; (or ROLLBACK; to undo)
SELECT id, content_id, content_type, title, rater_count FROM works ORDER BY content_type, id;
-- COMMIT;
