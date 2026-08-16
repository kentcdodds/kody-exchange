import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { handleRequest } from '#src/index.ts'
import {
	listAdminRolePermissionStrings,
	listRegistryPermissionStrings,
	listUserRolePermissionStrings,
	userHasPermission,
	userHasRole,
} from '#src/permissions.ts'
import {
	assignUserRole,
	ensureAccountRoles,
	getUserRolesAndPermissions,
	removeUserRole,
} from '#src/permissions-db.ts'
import {
	createSignedInUser,
	createTestEnv,
	request,
} from '#src/test-support.ts'

test('permission registry matches the RBAC migration', () => {
	const sql = readFileSync(
		join(
			dirname(fileURLToPath(import.meta.url)),
			'../migrations/0007_rbac.sql',
		),
		'utf8',
	)
	const inserted = [
		...sql.matchAll(
			/'((?:create|read|update|delete))', '((?:user|role))', '((?:own|any))'/g,
		),
	].map((match) => `${match[1]}:${match[2]}:${match[3]}`)
	expect(inserted.toSorted()).toEqual(
		listRegistryPermissionStrings().toSorted(),
	)
	expect(
		listUserRolePermissionStrings().every((item) => item.endsWith(':own')),
	).toBe(true)
	expect(listAdminRolePermissionStrings()).toEqual(
		listRegistryPermissionStrings(),
	)
})

test('signup assigns the user role and bootstraps admin for the first operator', async () => {
	const env = createTestEnv()
	const operator = await createSignedInUser(env, {
		id: 'usr_op',
		github_id: '99',
		login: 'kentcdodds',
	})
	const member = await createSignedInUser(env, {
		id: 'usr_member',
		github_id: '8',
		login: 'jane',
	})

	expect(operator.user.roles).toEqual(['admin', 'user'])
	expect(userHasPermission(operator.user, 'read:user:any')).toBe(true)
	expect(userHasPermission(operator.user, 'update:user:any')).toBe(true)
	expect(member.user.roles).toEqual(['user'])
	expect(userHasPermission(member.user, 'read:user:any')).toBe(false)
	expect(userHasPermission(member.user, 'read:user:own')).toBe(true)
	expect(userHasRole(member.user, 'admin')).toBe(false)
})

test('admin routes follow the role, not the GitHub login', async () => {
	const env = createTestEnv()
	const promoted = await createSignedInUser(env, {
		id: 'usr_promoted',
		github_id: '11',
		login: 'sam',
	})
	await assignUserRole({
		db: env.DB,
		userId: promoted.user.id,
		roleName: 'admin',
	})
	const demoted = await createSignedInUser(env, {
		id: 'usr_demoted',
		github_id: '99',
		login: 'kentcdodds',
	})
	await removeUserRole({
		db: env.DB,
		userId: demoted.user.id,
		roleName: 'admin',
	})

	const allowed = await handleRequest(
		request('/admin', { headers: { cookie: promoted.cookie } }),
		env,
	)
	expect(allowed.status).toBe(200)
	expect(await allowed.text()).toContain('Usage')

	const denied = await handleRequest(
		request('/admin', { headers: { cookie: demoted.cookie } }),
		env,
	)
	expect(denied.status).toBe(404)

	const grantDenied = await handleRequest(
		request('/account/grants', {
			method: 'POST',
			headers: {
				cookie: demoted.cookie,
				'content-type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				csrf: demoted.csrf,
				login: 'anyone',
			}),
		}),
		env,
	)
	expect(grantDenied.status).toBe(404)
})

test('userHasPermission is explicit and fail-closed', () => {
	expect(userHasPermission(null, 'read:user:any')).toBe(false)
	expect(userHasPermission({ permissions: [] }, 'read:user:own')).toBe(false)
	expect(
		userHasPermission({ permissions: ['read:user:own'] }, 'read:user:own'),
	).toBe(true)
	expect(
		userHasPermission({ permissions: ['read:user:own'] }, 'read:user:any'),
	).toBe(false)
})

test('ensureAccountRoles is idempotent and unknown users fail closed', async () => {
	const env = createTestEnv()
	const created = await createSignedInUser(env, {
		id: 'usr_once',
		login: 'pat',
	})
	const again = await ensureAccountRoles(env.DB, created.user.id, 'pat')
	expect(again.roles).toEqual(['user'])
	const access = await getUserRolesAndPermissions(env.DB, created.user.id)
	expect(access.roles).toEqual(['user'])
	expect(await getUserRolesAndPermissions(env.DB, 'usr_missing')).toEqual({
		roles: [],
		permissions: [],
	})
})
