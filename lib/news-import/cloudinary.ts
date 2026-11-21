/**
 * Server-side signed Cloudinary uploads.
 *
 * Imported images are re-hosted, never hotlinked: the source URL is only ever a
 * request parameter to Cloudinary. public_id is derived from a hash of the
 * source URL so repeated runs reuse the same asset instead of duplicating it.
 */

import { createHash } from 'node:crypto'
import type { CloudinaryConfig } from './config'

export const IMPORTED_IMAGE_FOLDER = 'futo-central/news/imported'

export function cloudinaryPublicId(sourceUrl: string): string {
  const digest = createHash('sha1').update(sourceUrl).digest('hex').slice(0, 20)
  return `${IMPORTED_IMAGE_FOLDER}/${digest}`
}

/** sha1 of the alphabetically sorted signed params followed by the API secret. */
export function cloudinarySignature(params: Record<string, string>, apiSecret: string): string {
  const toSign = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&')
  return createHash('sha1').update(`${toSign}${apiSecret}`).digest('hex')
}

/** Insert delivery transformations straight after /upload/. */
export function withAutoDelivery(secureUrl: string): string {
  return secureUrl.includes('/upload/') ? secureUrl.replace('/upload/', '/upload/f_auto,q_auto/') : secureUrl
}

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim())
}

/** Obvious tracking pixels and spacers are not worth a Cloudinary upload. */
export function isTrackingPixel(url: string): boolean {
  const value = url.toLowerCase()
  if (/1x1|pixel\.(?:gif|png)|spacer|transparent\.gif|tracking|beacon\.gif/.test(value)) return true
  if (/[?&](?:w|width)=1(?:&|$)/.test(value)) return true
  return false
}

export type UploadResult = { secureUrl: string; publicId: string }

export async function uploadRemoteImage(sourceUrl: string, config: CloudinaryConfig, timeoutMs = 20000): Promise<UploadResult> {
  const publicId = cloudinaryPublicId(sourceUrl)
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = cloudinarySignature({ public_id: publicId, timestamp }, config.apiSecret)

  const form = new FormData()
  form.append('file', sourceUrl)
  form.append('public_id', publicId)
  form.append('timestamp', timestamp)
  form.append('api_key', config.apiKey)
  form.append('signature', signature)

  const response = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`, {
    method: 'POST',
    body: form,
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!response.ok) throw new Error(`CLOUDINARY_UPLOAD_${response.status}`)

  const body = (await response.json()) as { secure_url?: unknown }
  if (typeof body.secure_url !== 'string' || !body.secure_url) throw new Error('CLOUDINARY_NO_SECURE_URL')
  return { secureUrl: withAutoDelivery(body.secure_url), publicId }
}
