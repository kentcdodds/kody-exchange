ALTER TABLE threads ADD COLUMN archived_at INTEGER;

CREATE INDEX threads_live_owner ON threads (owner_user_id, expires_at, archived_at);
CREATE INDEX threads_live_guest ON threads (creator_ip, expires_at, archived_at);
