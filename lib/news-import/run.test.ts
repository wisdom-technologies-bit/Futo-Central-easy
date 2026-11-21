import { beforeEach, describe, expect, it, vi } from 'vitest'

const { state, pool } = vi.hoisted(() => {
  const state = { queries: [] as string[], inserts: 0 }
  const pool = {
    query: async (sql: string) => {
      state.queries.push(sql)
      if (/^\s*insert/i.test(sql)) state.inserts += 1
      return { rows: [], rowCount: 0 }
    },
  }
  return { state, pool }
})

vi.mock('@/lib/db', () => ({
  withDatabase: (work: (db: typeof pool) => unknown) => work(pool),
  getDatabase: () => pool,
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { runNewsImport } from './run'

const BODY = `The National Universities Commission has approved full accreditation for six engineering programmes at the Federal University of Technology, Owerri, following a review that began in March.

The commission said the decision followed an assessment of staffing, laboratory facilities and library holdings across the affected departments. The approval covers civil, mechanical, electrical, agricultural, petroleum and metallurgical engineering.

Speaking on the outcome, the registrar said the accreditation would allow the institution to admit more students into the affected programmes from the next academic session. He added that the university had committed to further investment in laboratory equipment.

Applicants and current students can confirm the status of each programme through the registry.`

function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

const payload = {
  meta: { total: 4, has_more: false },
  data: [
    {
      id: 'abc123def',
      title: 'FUTO approves new engineering accreditation',
      excerpt: 'Six engineering programmes have received full accreditation.',
      content: `# FUTO approves new engineering accreditation\n\n${BODY}\n\nCONTINUE READING\n\n![Convocation hall](https://news.example.com/hall.jpg)`,
      source_name: 'Campus Reporter',
      source_url: 'https://news.example.com/story',
      image_url: 'https://news.example.com/featured.jpg',
      published_at: isoDaysAgo(1),
      category: 'Academics',
      institution: 'FUTO',
      country: 'NG',
      original_language: 'en',
      is_verified: true,
    },
    {
      id: 'expo0001',
      title: 'FUTO expo: leaked questions and free answers',
      excerpt: 'Exam expo.',
      content: BODY,
      source_name: 'Campus Reporter',
      published_at: isoDaysAgo(1),
    },
    {
      id: 'old00001',
      title: 'Last year convocation ceremony held in Owerri',
      excerpt: 'Old news.',
      content: BODY,
      source_name: 'Campus Reporter',
      published_at: isoDaysAgo(40),
    },
    {
      id: 'short001',
      title: 'Short notice about a meeting',
      excerpt: 'Short.',
      content: 'Too short to publish.',
      source_name: 'Campus Reporter',
      published_at: isoDaysAgo(1),
    },
  ],
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  state.queries.length = 0
  state.inserts = 0
  process.env.EDU_NEWS_API_URL = 'https://news-api.test'
  process.env.IMPORT_SECRET = 'test-secret'
  process.env.IMPORT_SOURCE_ALLOWLIST = 'src-a,src-b'
  process.env.IMPORT_CONTENT_MODE = 'truncated'
  process.env.IMPORT_TRUNCATE_CHARS = '1500'
  process.env.IMPORT_MAX_AGE_DAYS = '10'
  process.env.GROQ_API_KEY = 'test-key'
  process.env.GROQ_FAIL_MODE = 'closed'
  process.env.CLOUDINARY_CLOUD_NAME = 'demo'
  process.env.CLOUDINARY_API_KEY = 'key'
  process.env.CLOUDINARY_API_SECRET = 'secret'
  delete process.env.IMPORT_NOTIFY
  fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('runNewsImport dry run', () => {
  it('lists what would be imported and why the rest were skipped', async () => {
    const result = await runNewsImport({ dry: true })

    expect(result.summary.ok).toBe(true)
    expect(result.summary.fetched).toBe(4)
    expect(result.summary.inserted).toBe(1)

    const candidates = result.dry?.candidates ?? []
    expect(candidates).toHaveLength(1)
    expect(candidates[0].title).toBe('FUTO approves new engineering accreditation')
    expect(candidates[0].slug).toBe('futo-approves-new-engineering-accreditation-abc123')
    expect(candidates[0].category).toBe('Education News')
    expect(candidates[0].source_name).toBe('Campus Reporter')
    expect(candidates[0].tags).toEqual(['Academics', 'FUTO'])
    expect(candidates[0].images).toEqual(['https://news.example.com/featured.jpg', 'https://news.example.com/hall.jpg'])

    const reasons = (result.dry?.skipped ?? []).map((entry) => entry.reason)
    expect(reasons).toEqual(expect.arrayContaining(['blocklisted_title', 'too_old', 'content_too_short']))

    // A dry run writes nothing at all.
    expect(state.inserts).toBe(0)
    expect(state.queries.some((sql) => /^\s*insert/i.test(sql))).toBe(false)

    // The API is called with the source IDs, not source names.
    const requested = String(fetchMock.mock.calls[0][0])
    expect(requested).toContain('/api/news?')
    expect(requested).toContain('source=src-a%2Csrc-b')
    expect(requested).toContain('days=10')
    expect(requested).toContain('sort=newest')
  })

  it('removes the duplicate heading and the CONTINUE READING line', async () => {
    const result = await runNewsImport({ dry: true })
    const entry = result.dry?.candidates[0]
    expect(entry?.content_chars).toBeGreaterThan(300)
    // 700-odd characters of prose: the furniture was stripped, the story kept.
    expect(entry?.content_chars).toBeLessThan(1000)
  })
})

describe('runNewsImport guards', () => {
  it('inserts nothing when GROQ_API_KEY is missing and fail mode is closed', async () => {
    delete process.env.GROQ_API_KEY
    process.env.GROQ_FAIL_MODE = 'closed'

    const result = await runNewsImport({ dry: false })

    expect(result.summary.ok).toBe(false)
    expect(result.summary.error).toContain('GROQ_API_KEY')
    expect(result.summary.inserted).toBe(0)
    expect(state.inserts).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns a clear error and imports nothing when the allowlist is empty', async () => {
    process.env.IMPORT_SOURCE_ALLOWLIST = ''

    const result = await runNewsImport({ dry: true })

    expect(result.summary.ok).toBe(false)
    expect(result.summary.error).toContain('IMPORT_SOURCE_ALLOWLIST')
    expect(result.summary.inserted).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('aborts when Cloudinary is not configured, instead of hotlinking', async () => {
    delete process.env.CLOUDINARY_API_SECRET

    const result = await runNewsImport({ dry: false })

    expect(result.summary.ok).toBe(false)
    expect(result.summary.error).toContain('Cloudinary')
    expect(state.inserts).toBe(0)
  })
})
