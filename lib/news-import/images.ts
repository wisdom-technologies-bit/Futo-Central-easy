import { isCaptionBlock, isImageOnlyBlock, joinBlocks, splitMarkdownBlocks } from './blocks'
import { isHttpUrl, isTrackingPixel, uploadRemoteImage } from './cloudinary'
import type { CloudinaryConfig } from './config'

const MARKDOWN_IMAGE = /!\[([^\]]*)\]\(\s*([^)\s]+)((?:\s+"[^"]*")?)\s*\)/g
const RAW_IMAGE = /<img\b[^>]*?\bsrc\s*=\s*(["'])([^"']+)\1[^>]*>/gi

/** Every image URL referenced by a story, in document order. */
export function collectImageUrls(content: string): string[] {
  const found: string[] = []
  for (const match of content.matchAll(MARKDOWN_IMAGE)) found.push(match[2])
  for (const match of content.matchAll(RAW_IMAGE)) found.push(match[2])
  return found
}

export type ImagePlan = { uploads: string[]; skipped: string[] }

/**
 * Which images would be uploaded (dry run) and which are ignored. The featured
 * image_url counts towards the per-article cap and is uploaded first.
 */
export function planArticleImages(content: string, imageUrl: string | null | undefined, maxImages: number): ImagePlan {
  const ordered: string[] = []
  const featured = typeof imageUrl === 'string' ? imageUrl.trim() : ''
  if (featured) ordered.push(featured)
  ordered.push(...collectImageUrls(content))

  const uploads: string[] = []
  const skipped: string[] = []
  const seen = new Set<string>()
  for (const url of ordered) {
    if (seen.has(url)) continue
    seen.add(url)
    if (!isHttpUrl(url) || isTrackingPixel(url)) {
      skipped.push(url)
      continue
    }
    if (uploads.length >= maxImages) {
      skipped.push(url)
      continue
    }
    uploads.push(url)
  }
  return { uploads, skipped }
}

export type ImageOutcome = {
  content: string
  featuredImage: string | null
  featuredImageAlt: string
  uploads: number
  failures: number
  uploaded: string[]
}

/**
 * Re-host every image through Cloudinary and rewrite the Markdown. A failed
 * upload removes the image (and its italic caption) rather than leaving a
 * hotlinked third-party URL in the story.
 */
export async function processArticleImages(input: {
  content: string
  imageUrl?: string | null
  title: string
  maxImages: number
  cloudinary: CloudinaryConfig
  timeoutMs?: number
}): Promise<ImageOutcome> {
  const plan = planArticleImages(input.content, input.imageUrl, input.maxImages)
  const replacements = new Map<string, string>()
  const failed = new Set<string>()
  let uploads = 0

  for (const url of plan.uploads) {
    try {
      const result = await uploadRemoteImage(url, input.cloudinary, input.timeoutMs ?? 20000)
      replacements.set(url, result.secureUrl)
      uploads += 1
    } catch {
      failed.add(url)
    }
  }

  const originalBlocks = splitMarkdownBlocks(input.content)
  const removed = new Set<number>()
  const rewritten: string[] = []

  for (let index = 0; index < originalBlocks.length; index += 1) {
    if (removed.has(index)) continue
    const block = originalBlocks[index]
    let next = block.replace(MARKDOWN_IMAGE, (full, alt: string, url: string, title: string) => {
      const mapped = replacements.get(url)
      if (mapped) return `![${alt}](${mapped}${title ?? ''})`
      if (failed.has(url)) return ''
      return full
    })
    next = next.replace(RAW_IMAGE, (full, quote: string, url: string) => {
      const mapped = replacements.get(url)
      if (mapped) return full.replace(url, mapped)
      if (failed.has(url)) return ''
      return full
    })

    if (block !== next && isImageOnlyBlock(block) && !next.trim()) {
      removed.add(index)
      const caption = originalBlocks[index + 1]
      if (caption !== undefined && isCaptionBlock(caption)) removed.add(index + 1)
      continue
    }
    rewritten.push(next.trim())
  }

  const featuredCandidate = typeof input.imageUrl === 'string' ? input.imageUrl.trim() : ''
  const firstBodyImage = plan.uploads
    .filter((url) => url !== featuredCandidate && replacements.has(url))
    .map((url) => replacements.get(url) as string)[0]

  const featuredImage = (featuredCandidate && replacements.get(featuredCandidate)) || firstBodyImage || null

  return {
    content: joinBlocks(rewritten.filter(Boolean)),
    featuredImage,
    featuredImageAlt: input.title,
    uploads,
    failures: failed.size,
    uploaded: plan.uploads.filter((url) => replacements.has(url)).map((url) => replacements.get(url) as string),
  }
}

/** True when any third-party image URL is still present in the stored content. */
export function findHotlinkedImages(content: string, allowedHost: string): string[] {
  return collectImageUrls(content).filter((url) => {
    if (!isHttpUrl(url)) return false
    try {
      return new URL(url).hostname !== allowedHost
    } catch {
      return true
    }
  })
}
