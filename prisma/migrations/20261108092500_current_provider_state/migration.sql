-- Preserve imported provenance while retiring runtime conversion branches.
BEGIN;
DO $$ BEGIN
 PERFORM key FROM "OperationalState" WHERE key='artist-enrichment' FOR UPDATE;
 IF EXISTS (SELECT 1 FROM "OperationalState" WHERE key='artist-enrichment' AND "leaseOwner" IS NOT NULL AND "leaseExpiresAt">CURRENT_TIMESTAMP) THEN
  RAISE EXCEPTION 'Artist enrichment is active; retry after it drains';
 END IF;
 IF EXISTS (SELECT 1 FROM "CatalogPlaylistRefresh" WHERE status='RUNNING' AND "leaseOwner" IS NOT NULL AND "leaseExpiresAt">CURRENT_TIMESTAMP) THEN
  RAISE EXCEPTION 'Provider operation is active; retry after it drains';
 END IF;
 IF EXISTS (SELECT 1 FROM "OperationalState" WHERE key='artist-enrichment' AND payload ? 'legacyImport' AND payload ? 'importedEvidence' AND payload->'legacyImport' IS DISTINCT FROM payload->'importedEvidence') THEN
  RAISE EXCEPTION 'Conflicting imported evidence';
 END IF;
END $$;
UPDATE "OperationalState" SET payload=(payload - 'legacyImport') || jsonb_build_object('importedEvidence',payload->'legacyImport'), "updatedAt"=CURRENT_TIMESTAMP
WHERE key='artist-enrichment' AND payload ? 'legacyImport';
-- Preserve the exact reserved expected content; do not clear or replay any write.
UPDATE "CatalogPlaylistRefresh" SET "youtubeState"=jsonb_set("youtubeState",'{pendingInsert}',("youtubeState"->'pendingInsert') || jsonb_build_object(
 'beforeIds',COALESCE((SELECT jsonb_agg(value ORDER BY ordinality) FROM jsonb_array_elements("youtubeState"->'pendingInsert'->'expectedIds') WITH ORDINALITY AS ids(value,ordinality) WHERE ordinality < jsonb_array_length("youtubeState"->'pendingInsert'->'expectedIds')),'[]'::jsonb),
 'position',jsonb_array_length("youtubeState"->'pendingInsert'->'expectedIds')-1))
WHERE jsonb_typeof("youtubeState"->'pendingInsert')='object'
 AND jsonb_typeof("youtubeState"->'pendingInsert'->'expectedIds')='array'
 AND jsonb_array_length("youtubeState"->'pendingInsert'->'expectedIds')>0
 AND NOT ("youtubeState"->'pendingInsert' ? 'beforeIds');
COMMIT;
