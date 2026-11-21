import 'server-only'

export type NotificationCopy = {
  heading?: string
  message?: string
  url?: string
}

type PushPayload = { heading: string; message: string; url: string; image?: string }

async function sendPush(payload: PushPayload) {
  const appId = process.env.ONESIGNAL_APP_ID
  const apiKey = process.env.ONESIGNAL_API_KEY
  if (!appId || !apiKey) throw new Error('ONESIGNAL_NOT_CONFIGURED')
  const response = await fetch('https://api.onesignal.com/notifications', { method: 'POST', headers: { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ app_id: appId, target_channel: 'push', included_segments: ['Subscribed Users'], headings: { en: payload.heading }, contents: { en: payload.message }, url: payload.url, chrome_web_image: payload.image || undefined, big_picture: payload.image || undefined }), cache: 'no-store' })
  if (!response.ok) throw new Error(`ONESIGNAL_${response.status}`)
}

/**
 * Defaults reproduce the original editorial push exactly: the same heading,
 * the same "New FUTO news:" prefix and the same article URL.
 */
export async function sendNewsNotification(article: { title: string; slug: string; image?: string }, copy: NotificationCopy = {}) {
  await sendPush({
    heading: copy.heading ?? 'FUTO Central — New News',
    message: copy.message ?? `New FUTO news: ${article.title}`,
    url: copy.url ?? `https://futocentral.name.ng/news/${encodeURIComponent(article.slug)}`,
    image: article.image,
  })
}

/** One grouped push for a batch of imported stories. */
export async function sendDigestNotification(payload: { heading: string; message: string; url: string }) {
  await sendPush(payload)
}
