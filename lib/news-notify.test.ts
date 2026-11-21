import { beforeEach, describe, expect, it, vi } from 'vitest'

const { state, db, sendNews } = vi.hoisted(() => {
  const state = { claimRowCount: 1, statements: [] as string[] }
  const db = {
    query: async (sql: string) => {
      state.statements.push(sql)
      if (/SET notification_sent_at = NOW\(\)/.test(sql)) return { rows: [{ id: 'article-1' }], rowCount: state.claimRowCount }
      return { rows: [], rowCount: 1 }
    },
  }
  const sendNews = vi.fn(async () => {})
  return { state, db, sendNews }
})

vi.mock('@/lib/db', () => ({ withDatabase: (work: (pool: typeof db) => unknown) => work(db) }))
vi.mock('@/lib/onesignal', () => ({
  sendNewsNotification: sendNews,
  sendDigestNotification: vi.fn(async () => {}),
}))

import { notifyOnce } from './news-notify'

beforeEach(() => {
  state.claimRowCount = 1
  state.statements.length = 0
  sendNews.mockClear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('notifyOnce', () => {
  it('sends exactly one push for an editor publish', async () => {
    const sent = await notifyOnce('article-1', { title: 'FUTO announces new session dates', slug: 'futo-announces-new-session-dates' })

    expect(sent).toBe(true)
    expect(sendNews).toHaveBeenCalledTimes(1)
    // No override: the editor path keeps the original OneSignal copy.
    expect(sendNews).toHaveBeenCalledWith({ title: 'FUTO announces new session dates', slug: 'futo-announces-new-session-dates' }, {})
  })

  it('does not send again once the notification has been claimed', async () => {
    await notifyOnce('article-1', { title: 'First publish', slug: 'first-publish' })
    state.claimRowCount = 0
    const second = await notifyOnce('article-1', { title: 'Saved again later', slug: 'first-publish' })

    expect(second).toBe(false)
    expect(sendNews).toHaveBeenCalledTimes(1)
  })

  it('rolls the claim back when the push fails, so it can be retried', async () => {
    sendNews.mockRejectedValueOnce(new Error('ONESIGNAL_500'))

    const sent = await notifyOnce('article-1', { title: 'FUTO announces new session dates', slug: 'futo-announces-new-session-dates' })

    expect(sent).toBe(false)
    expect(state.statements.some((sql) => /SET notification_sent_at = NULL/.test(sql))).toBe(true)
  })

  it('passes importer copy through when supplied', async () => {
    await notifyOnce(
      'article-1',
      { title: 'NUC accredits engineering programmes', slug: 'nuc-accredits-engineering-programmes' },
      {
        heading: 'FUTO Central — Education News',
        message: 'NUC accredits engineering programmes',
        url: 'https://futocentral.name.ng/news/nuc-accredits-engineering-programmes',
      },
    )

    expect(sendNews).toHaveBeenCalledWith(expect.objectContaining({ slug: 'nuc-accredits-engineering-programmes' }), {
      heading: 'FUTO Central — Education News',
      message: 'NUC accredits engineering programmes',
      url: 'https://futocentral.name.ng/news/nuc-accredits-engineering-programmes',
    })
  })
})
