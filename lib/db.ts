import { Pool } from 'pg'

let pool: Pool | null = null

function getDatabaseUrl() {
  const value = process.env.DATABASE_URL?.trim()
  if (!value) return null
  try {
    const url = new URL(value)
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) throw new Error('invalid protocol or host')
    return value
  } catch {
    throw new Error('DATABASE_URL_INVALID: expected a complete postgres:// or postgresql:// connection string')
  }
}

export function getDatabase() {
  const connectionString = getDatabaseUrl()
  if (!connectionString) return null
  pool ??= new Pool({ connectionString, max: 5, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined })
  return pool
}

export async function withDatabase<T>(work: (db: Pool) => Promise<T>) {
  const db = getDatabase()
  if (!db) throw new Error('DATABASE_NOT_CONFIGURED')
  return work(db)
}
