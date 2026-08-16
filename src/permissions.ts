import { type UserRow } from '#src/threads.ts'

export const permissionActions = ['create', 'read', 'update', 'delete'] as const
export const permissionEntities = ['user', 'role'] as const
export const permissionAccesses = ['own', 'any'] as const
export const roleNames = ['user', 'admin'] as const

export type PermissionAction = (typeof permissionActions)[number]
export type PermissionEntity = (typeof permissionEntities)[number]
export type PermissionAccess = (typeof permissionAccesses)[number]
export type RoleName = (typeof roleNames)[number]

export type PermissionString =
	`${PermissionAction}:${PermissionEntity}:${PermissionAccess}`

export type AccessUser = {
	roles: Array<RoleName>
	permissions: Array<PermissionString>
}

export type SessionUser = UserRow & AccessUser

export const bootstrapAdminLogin = 'kentcdodds'

export function isBootstrapAdminLogin(login: string) {
	return login.toLowerCase() === bootstrapAdminLogin
}

export function isRoleName(value: string): value is RoleName {
	return roleNames.includes(value as RoleName)
}

export function isPermissionString(value: string): value is PermissionString {
	const [action, entity, access] = value.split(':')
	return (
		permissionActions.includes(action as PermissionAction) &&
		permissionEntities.includes(entity as PermissionEntity) &&
		permissionAccesses.includes(access as PermissionAccess)
	)
}

export function parsePermissionString(value: PermissionString) {
	const [action, entity, access] = value.split(':') as [
		PermissionAction,
		PermissionEntity,
		PermissionAccess,
	]
	return { action, entity, access }
}

export function buildPermissionString(input: {
	action: PermissionAction
	entity: PermissionEntity
	access: PermissionAccess
}): PermissionString {
	return `${input.action}:${input.entity}:${input.access}`
}

export function listRegistryPermissionStrings(): Array<PermissionString> {
	const permissions: Array<PermissionString> = []
	for (const action of permissionActions) {
		for (const entity of permissionEntities) {
			for (const access of permissionAccesses) {
				permissions.push(buildPermissionString({ action, entity, access }))
			}
		}
	}
	return permissions
}

export function listUserRolePermissionStrings(): Array<PermissionString> {
	return listRegistryPermissionStrings().filter((permission) =>
		permission.endsWith(':own'),
	)
}

export function listAdminRolePermissionStrings(): Array<PermissionString> {
	return listRegistryPermissionStrings()
}

export function userHasPermission(
	user: object | null | undefined,
	permission: PermissionString,
) {
	if (!user || !('permissions' in user) || !Array.isArray(user.permissions)) {
		return false
	}
	return user.permissions.includes(permission)
}

export function userHasRole(user: object | null | undefined, role: RoleName) {
	if (!user || !('roles' in user) || !Array.isArray(user.roles)) {
		return false
	}
	return user.roles.includes(role)
}

export function emptyAccess(): AccessUser {
	return { roles: [], permissions: [] }
}
