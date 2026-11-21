import { createHash, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { after } from 'next/server'
import { findBlockingConfigError, readImportConfig } from '@/lib/news-import/config'
import { runNewsImport } from '@/lib/news-import/run'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Length-safe constant time comparison. */
function constantTimeEquals(left: string, right: string): boolean {
  const a = createHash('sha256').update(left).digest()
  const b = createHash('sha256').update(right).digest()
  return timingSafeEqual(a, b)
}

/** x-import-secret, or Authorization: Bearer. Never the query string. */
function providedSecret(request: Request): string {
  const header = request.headers.get('x-import-secret')
  if (header) return header.trim()
  const authorization = request.headers.get('authorization') ?? ''
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : ''
}

export async function POST(request: Request) {
  const config = readImportConfig()

  if (!config.importSecret) {
    return NextResponse.json({ accepted: false, error: 'IMPORT_SECRET is not configured on the server.' }, { status: 503 })
  }

  const provided = providedSecret(request)
  if (!provided || !constantTimeEquals(provided, config.importSecret)) {
    return NextResponse.json({ accepted: false, error: 'Unauthorized' }, { status: 401 })
  }

  const params = new URL(request.url).searchParams
  const dry = params.get('dry') === '1'
  const moderate = params.get('moderate') === '1'

  const blocking = findBlockingConfigError(config)
  if (blocking) {
    return NextResponse.json({ accepted: false, error: blocking }, { status: 503 })
  }

  if (dry) {
    const result = await runNewsImport({ dry: true, moderate })
    return NextResponse.json(result, { status: result.summary.ok ? 200 : 503 })
  }

  // cron-job.org gives up at 30s, so acknowledge first and finish in the background.
  after(async () => {
    try {
      await runNewsImport({ dry: false })
    } catch (error) {
      console.error('[v0] news import run failed:', error instanceof Error ? error.message : 'unknown')
    }
  })

  return NextResponse.json({ accepted: true }, { status: 202 })
}
