import { spawn } from 'node:child_process'
import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type CliOptions = {
	env?: string
	name?: string
	config?: string
	setFromEnv: Array<string>
	setFromEnvOptional: Array<string>
}

function fail(message: string): never {
	console.error(message)
	process.exit(1)
}

function parseArgs(argv: Array<string>): CliOptions {
	const options: CliOptions = {
		setFromEnv: [],
		setFromEnvOptional: [],
	}
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index]
		if (!arg) continue
		switch (arg) {
			case '--env':
				options.env = argv[index + 1] ?? ''
				index += 1
				break
			case '--name':
				options.name = argv[index + 1] ?? ''
				index += 1
				break
			case '--config':
				options.config = argv[index + 1] ?? ''
				index += 1
				break
			case '--set-from-env':
				options.setFromEnv.push(argv[index + 1] ?? '')
				index += 1
				break
			case '--set-from-env-optional':
				options.setFromEnvOptional.push(argv[index + 1] ?? '')
				index += 1
				break
			default:
				if (arg.startsWith('-')) fail(`Unknown flag: ${arg}`)
		}
	}
	return options
}

function buildSecrets(options: CliOptions) {
	const secrets = new Map<string, string>()
	for (const key of options.setFromEnv) {
		const value = process.env[key]
		if (typeof value !== 'string' || value.length === 0) {
			fail(`Missing required environment variable: ${key}`)
		}
		secrets.set(key, value)
	}
	for (const key of options.setFromEnvOptional) {
		const value = process.env[key]
		if (typeof value === 'string' && value.length > 0) {
			secrets.set(key, value)
		}
	}
	return secrets
}

async function main() {
	const options = parseArgs(process.argv.slice(2))
	const secrets = buildSecrets(options)
	if (secrets.size === 0) {
		console.log('No secrets to sync (optional set was empty).')
		return
	}
	const dotenvText = `${Array.from(secrets.entries())
		.toSorted(([left], [right]) => left.localeCompare(right))
		.map(([key, value]) => `${key}=${value}`)
		.join('\n')}\n`
	const secretsFilePath = join(
		tmpdir(),
		`wrangler-secrets-${Date.now()}-${crypto.randomUUID()}.env`,
	)
	await writeFile(secretsFilePath, dotenvText, { mode: 0o600 })
	const wranglerBin = join(process.cwd(), 'node_modules', '.bin', 'wrangler')
	const args = [wranglerBin, 'secret', 'bulk', secretsFilePath]
	if (options.env) args.push('--env', options.env)
	if (options.name) args.push('--name', options.name)
	if (options.config) args.push('--config', options.config)
	try {
		const exitCode = await new Promise<number>((resolve, reject) => {
			const child = spawn(args[0] ?? wranglerBin, args.slice(1), {
				stdio: 'inherit',
				env: process.env,
			})
			child.once('error', reject)
			child.once('exit', (code) => resolve(code ?? 1))
		})
		if (exitCode !== 0) process.exit(exitCode)
	} finally {
		await unlink(secretsFilePath).catch(() => {})
	}
	console.log(`Synced ${secrets.size} secret(s) via wrangler secret bulk.`)
}

await main()
