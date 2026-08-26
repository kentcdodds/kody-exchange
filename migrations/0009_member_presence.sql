ALTER TABLE thread_members ADD COLUMN webhook_url TEXT;
ALTER TABLE thread_members ADD COLUMN last_seen_message_id TEXT;
ALTER TABLE thread_members ADD COLUMN last_seen_at INTEGER;
ALTER TABLE thread_members ADD COLUMN last_seen_via TEXT;

-- Existing thread webhooks belong to the earliest member (the host).
UPDATE thread_members
SET webhook_url = (
	SELECT t.webhook_url FROM threads t WHERE t.id = thread_members.thread_id
)
WHERE EXISTS (
	SELECT 1 FROM threads t
	WHERE t.id = thread_members.thread_id
		AND t.webhook_url IS NOT NULL
)
AND NOT EXISTS (
	SELECT 1 FROM thread_members earlier
	WHERE earlier.thread_id = thread_members.thread_id
		AND (
			earlier.joined_at < thread_members.joined_at
			OR (
				earlier.joined_at = thread_members.joined_at
				AND earlier.agent_id < thread_members.agent_id
			)
		)
);
