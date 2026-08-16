import { all, run } from '#src/db.ts'
import {
	emptyAccess,
	isPermissionString,
	isRoleName,
	type AccessUser,
	type PermissionString,
	type RoleName,
} from '#src/permissions.ts'

type PermissionRow = {
	role_name: string
	action: string | null
	entity: string | null
	access: string | null
}

export async function getUserRolesAndPermissions(
	db: D1Database,
	userId: string,
): Promise<AccessUser> {
	const rows = await all<PermissionRow>(
		db,
		`SELECT DISTINCT r.name AS role_name, p.action, p.entity, p.access
		 FROM user_roles ur
		 INNER JOIN roles r ON r.id = ur.role_id
		 LEFT JOIN role_permissions rp ON rp.role_id = r.id
		 LEFT JOIN permissions p ON p.id = rp.permission_id
		 WHERE ur.user_id = ?`,
		userId,
	)
	const roleSet = new Set<RoleName>()
	const permissionSet = new Set<PermissionString>()
	for (const row of rows) {
		if (isRoleName(row.role_name)) roleSet.add(row.role_name)
		if (row.action && row.entity && row.access) {
			const permission = `${row.action}:${row.entity}:${row.access}`
			if (isPermissionString(permission)) permissionSet.add(permission)
		}
	}
	return {
		roles: [...roleSet].toSorted(),
		permissions: [...permissionSet].toSorted(),
	}
}

export async function assignUserRole(input: {
	db: D1Database
	userId: string
	roleName: RoleName
}) {
	const result = await run(
		input.db,
		`INSERT OR IGNORE INTO user_roles (user_id, role_id)
		 SELECT ?, id FROM roles WHERE name = ?`,
		input.userId,
		input.roleName,
	)
	return { assigned: (result.meta?.changes ?? 0) > 0 }
}

export async function removeUserRole(input: {
	db: D1Database
	userId: string
	roleName: RoleName
}) {
	await run(
		input.db,
		`DELETE FROM user_roles
		 WHERE user_id = ?
		   AND role_id = (SELECT id FROM roles WHERE name = ?)`,
		input.userId,
		input.roleName,
	)
}

export async function ensureAccountRoles(db: D1Database, userId: string) {
	await assignUserRole({ db, userId, roleName: 'user' })
	return getUserRolesAndPermissions(db, userId)
}

export async function loadAccessOrEmpty(
	db: D1Database,
	userId: string,
): Promise<AccessUser> {
	try {
		return await getUserRolesAndPermissions(db, userId)
	} catch {
		return emptyAccess()
	}
}
