import 'server-only'
import { withDatabase } from '@/lib/db'
import { sendDigestNotification, sendNewsNotification, type NotificationCopy } from '@/lib/onesignal'

/**
 * Atomically claim `notification_sent_at`, then send exactly one push.
 * The claim is rolled back when the send fails so a later attempt can retry.
 * This is the original editorial behaviour, moved here so the importer can
 * reuse it without importing the server actions module.
 */
export async function notifyOnce(id: string, article: { title: string; slug: string; image?: string }, copy: NotificationCopy = {}) {
  try {
    const claim = await withDatabase((db) => db.query(`UPDATE articles SET notification_sent_at = NOW() WHERE id = $1 AND status = 'published' AND notification_sent_at IS NULL RETURNING id`, [id]))
    if (!claim.rowCount) return false
    try {
      await sendNewsNotification(article, copy)
      return true
    } catch (error) {
      console.error('[v0] OneSignal notification failed:', error)
      await withDatabase((db) => db.query(`UPDATE articles SET notification_sent_at = NULL WHERE id = $1`, [id]))
      return false
    }
  } catch (error) {
    console.error('[v0] OneSignal notification claim failed:', error)
    return false
  }
}

/**
 * Claim a whole batch and send one grouped push. Every row is released again if
 * the single push fails, using the same rollback rule as notifyOnce.
 */
export async function notifyDigest(ids: string[], payload: { heading: string; message: string; url: string }) {
  if (!ids.length) return false
  try {
    const claim = await withDatabase((db) =>
      db.query(`UPDATE articles SET notification_sent_at = NOW() WHERE id = ANY($1::uuid[]) AND status = 'published' AND notification_sent_at IS NULL RETURNING id`, [ids]),
    )
    if (!claim.rowCount) return false
    const claimed = (claim.rows as { id: string }[]).map((row) => row.id)
    try {
      await sendDigestNotification(payload)
      return true
    } catch (error) {
      console.error('[v0] OneSignal digest notification failed:', error)
      await withDatabase((db) => db.query(`UPDATE articles SET notification_sent_at = NULL WHERE id = ANY($1::uuid[])`, [claimed]))
      return false
    }
  } catch (error) {
    console.error('[v0] OneSignal digest claim failed:', error)
    return false
  }
}
