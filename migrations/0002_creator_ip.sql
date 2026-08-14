ALTER TABLE threads ADD COLUMN creator_ip TEXT;

CREATE INDEX threads_guest_ip ON threads (creator_ip, expires_at);
