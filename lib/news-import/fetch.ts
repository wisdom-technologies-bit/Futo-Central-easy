import type { ImportConfig } from './config'
import type { EduNewsItem, EduNewsPage } from './types'

const PAGE_TIMEOUT_MS = 20000
const MAX_PAGES = 3
const PAGE_LIMIT = 100

function buildUrl(config: ImportConfig, page: number): string {
  const url = new URL(`${config.apiUrl}/api/news`)
  url.searchParams.set('days', String(config.maxAgeDays))
  url.searchParams.set('limit', String(PAGE_LIMIT))
  url.searchParams.set('page', String(page))
  url.searchParams.set('sort', 'newest')
  url.searchParams.set('source', config.sourceAllowlist.join(','))
  return url.toString()
}

async function fetchPage(url: string): Promise<{ items: EduNewsItem[]; hasMore: boolean }> {
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      })
      if (!response.ok) throw new Error(`EDU_NEWS_${response.status}`)
      const body = (await response.json()) as EduNewsPage
      const items = Array.isArray(body?.data) ? body.data : []
      return { items, hasMore: Boolean(body?.meta?.has_more) }
    } catch (error) {
      lastError = error
      // The API host may be waking up; one retry is enough.
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 750))
    }
  }
  throw lastError instanceof Error ? lastError : new Error('EDU_NEWS_FETCH_FAILED')
}

export type FetchResult = { items: EduNewsItem[]; pages: number; error?: string }

/** Up to three pages of 100 items, newest first. */
export async function fetchEduNews(config: ImportConfig): Promise<FetchResult> {
  const items: EduNewsItem[] = []
  let pages = 0
  try {
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const result = await fetchPage(buildUrl(config, page))
      pages = page
      items.push(...result.items)
      if (!result.hasMore || result.items.length < PAGE_LIMIT) break
    }
    return { items, pages }
  } catch (error) {
    return { items, pages, error: error instanceof Error ? error.message : 'EDU_NEWS_FETCH_FAILED' }
  }
}
