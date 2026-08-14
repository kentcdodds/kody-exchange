CREATE TABLE users (
	id TEXT PRIMARY KEY,
	github_id TEXT NOT NULL UNIQUE,
	login TEXT NOT NULL,
	name TEXT,
	avatar_url TEXT,
	email TEXT,
	plan TEXT NOT NULL DEFAULT 'free',
	stripe_customer_id TEXT,
	stripe_subscription_id TEXT,
	created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
	expires_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL
);

CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_expires ON sessions (expires_at);

CREATE TABLE agents (
	id TEXT PRIMARY KEY,
	user_id TEXT REFERENCES users (id) ON DELETE CASCADE,
	thread_id TEXT,
	name TEXT NOT NULL,
	token_hash TEXT NOT NULL UNIQUE,
	created_at INTEGER NOT NULL,
	revoked_at INTEGER
);

CREATE INDEX agents_user_live ON agents (user_id, revoked_at);
CREATE INDEX agents_thread ON agents (thread_id);

CREATE TABLE threads (
	id TEXT PRIMARY KEY,
	owner_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
	purpose TEXT,
	join_secret_hash TEXT NOT NULL,
	webhook_url TEXT,
	created_at INTEGER NOT NULL,
	expires_at INTEGER NOT NULL
);

CREATE INDEX threads_owner ON threads (owner_user_id);
CREATE INDEX threads_expires ON threads (expires_at);

CREATE TABLE thread_members (
	thread_id TEXT NOT NULL REFERENCES threads (id) ON DELETE CASCADE,
	agent_id TEXT NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
	joined_at INTEGER NOT NULL,
	PRIMARY KEY (thread_id, agent_id)
);

CREATE TABLE messages (
	id TEXT PRIMARY KEY,
	thread_id TEXT NOT NULL REFERENCES threads (id) ON DELETE CASCADE,
	from_agent_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	body TEXT NOT NULL,
	refs TEXT NOT NULL DEFAULT '[]',
	created_at INTEGER NOT NULL
);

CREATE INDEX messages_thread_created ON messages (thread_id, created_at);

CREATE TABLE usage_months (
	owner_key TEXT NOT NULL,
	yyyymm TEXT NOT NULL,
	message_count INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (owner_key, yyyymm)
);

CREATE TABLE blobs (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	thread_id TEXT,
	content_type TEXT NOT NULL,
	byte_size INTEGER NOT NULL,
	created_at INTEGER NOT NULL
);

CREATE INDEX blobs_user ON blobs (user_id);
