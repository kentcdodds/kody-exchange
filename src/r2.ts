/** R2 get that treats platform throws as a miss so callers can fall through. */
export async function getR2ObjectOrNull(
	bucket: Pick<R2Bucket, 'get'>,
	key: string,
): Promise<R2ObjectBody | null> {
	try {
		return await bucket.get(key)
	} catch {
		return null
	}
}
