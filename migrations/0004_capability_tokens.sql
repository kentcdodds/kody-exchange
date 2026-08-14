-- Pre-launch cutover: capability tokens replace public thread ids.
-- Existing rows cannot be rewritten without their plaintext secrets.
DELETE FROM messages;
DELETE FROM thread_members;
DELETE FROM blobs;
DELETE FROM agents WHERE thread_id IS NOT NULL;
DELETE FROM threads;

ALTER TABLE threads ADD COLUMN thread_secret TEXT NOT NULL DEFAULT '';
ALTER TABLE threads ADD COLUMN view_token_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE threads ADD COLUMN join_token_hash TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX threads_view_token_hash_uidx ON threads (view_token_hash);
CREATE UNIQUE INDEX threads_join_token_hash_uidx ON threads (join_token_hash);

ALTER TABLE threads DROP COLUMN join_secret_hash;
