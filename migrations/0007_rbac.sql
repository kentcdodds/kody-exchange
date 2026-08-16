CREATE TABLE roles (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL UNIQUE,
	description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE permissions (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	action TEXT NOT NULL,
	entity TEXT NOT NULL,
	access TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	UNIQUE (action, entity, access)
);

CREATE TABLE role_permissions (
	role_id INTEGER NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
	permission_id INTEGER NOT NULL REFERENCES permissions (id) ON DELETE CASCADE,
	PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_roles (
	user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
	role_id INTEGER NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
	PRIMARY KEY (user_id, role_id)
);

INSERT INTO roles (name, description) VALUES
	('user', 'Default role for every account'),
	('admin', 'Operator role');

INSERT INTO permissions (action, entity, access) VALUES
	('create', 'user', 'own'),
	('read', 'user', 'own'),
	('update', 'user', 'own'),
	('delete', 'user', 'own'),
	('create', 'role', 'own'),
	('read', 'role', 'own'),
	('update', 'role', 'own'),
	('delete', 'role', 'own'),
	('create', 'user', 'any'),
	('read', 'user', 'any'),
	('update', 'user', 'any'),
	('delete', 'user', 'any'),
	('create', 'role', 'any'),
	('read', 'role', 'any'),
	('update', 'role', 'any'),
	('delete', 'role', 'any');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
INNER JOIN permissions p ON p.access = 'own'
WHERE r.name = 'user';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
INNER JOIN permissions p
WHERE r.name = 'admin';

INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
INNER JOIN roles r ON r.name = 'user';

INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
INNER JOIN roles r ON r.name = 'admin'
WHERE lower(u.login) = 'kentcdodds';
