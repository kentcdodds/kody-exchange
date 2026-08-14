CREATE TABLE plan_grants (
	github_login TEXT PRIMARY KEY,
	plan TEXT NOT NULL,
	granted_at INTEGER NOT NULL
);
