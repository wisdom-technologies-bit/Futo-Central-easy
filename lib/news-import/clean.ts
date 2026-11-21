import { analyzeBlocks, isCaptionBlock, isImageOnlyBlock, joinBlocks, splitMarkdownBlocks, type BlockType } from './blocks'

/** Normalise text for loose comparisons (titles, duplicate headings). */
export function normalizeForCompare(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const CTA_LINE =
  /^\s*(continue reading|read more|read also|also read|see also|related stories|related posts|related articles|related:|recommended(?: for you)?|you may also like|advertisement|sponsored(?: content)?|click here to read more)\s*[:.]?\s*$/i

const CTA_START =
  /^\s*(continue reading|read more|read also|also read|see also|related stories|related posts|related articles|you may also like|click here to read more|recommended)\b/i

const RELATED_HEADING = /^\s*#{0,6}\s*(related|related stories|related posts|related articles|read next|more from|you may also like)\s*:?\s*$/i

/** A block whose only content is links (optionally bulleted). */
export function isLinkOnlyBlock(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (!/\[[^\]]*\]\([^)]*\)|<a\b/i.test(trimmed)) return false
  const stripped = trimmed
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s*/gm, '')
    .replace(/[\s\u2022|,;:·–—-]+/g, '')
  return stripped.length === 0
}

/**
 * Remove aggregation-site furniture from an imported story:
 * a leading heading that repeats the title, "CONTINUE READING" style lines,
 * "Also read:" link lists and "Related" link blocks. Blank runs collapse to one
 * empty line between blocks.
 */
export function cleanMarkdown(markdown: string, title: string): string {
  const titleKey = normalizeForCompare(title)
  const blocks = splitMarkdownBlocks(markdown.replace(/\u200b|\u00ad/g, ''))

  // Drop standalone call-to-action lines that sit inside an otherwise real block.
  const withoutCtaLines: string[] = []
  for (const block of blocks) {
    const kept = block
      .split('\n')
      .filter((line) => !CTA_LINE.test(line))
      .join('\n')
      .trim()
    if (kept) withoutCtaLines.push(kept)
  }

  const infos = analyzeBlocks(withoutCtaLines)
  const drop = new Set<number>()

  for (const info of infos) {
    if (drop.has(info.i)) continue
    const next = infos[info.i + 1]

    if (info.type === 'heading') {
      const key = normalizeForCompare(info.text.replace(/^#{1,6}\s*/, ''))
      if (key && (key === titleKey || (titleKey.length > 12 && key.includes(titleKey))) && info.i <= 1) {
        drop.add(info.i)
        continue
      }
      if (RELATED_HEADING.test(info.text)) {
        drop.add(info.i)
        if (next && isLinkOnlyBlock(next.text)) drop.add(next.i)
        continue
      }
    }

    if (CTA_START.test(info.text) && info.text.length <= 300) {
      drop.add(info.i)
      if (next && isLinkOnlyBlock(next.text)) drop.add(next.i)
      continue
    }

    // A bare link list that directly follows a removed block is navigation, not story.
    if (isLinkOnlyBlock(info.text) && (drop.has(info.i - 1) || CTA_START.test(info.text))) {
      drop.add(info.i)
    }
  }

  const kept = infos.filter((info) => !drop.has(info.i)).map((info) => info.text)
  return joinBlocks(kept)
}

/** Strip Markdown syntax so an excerpt reads as plain text. */
export function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Cut a plain string at a word boundary without adding an ellipsis. */
export function clipText(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)
  const boundary = cut.lastIndexOf(' ')
  return (boundary > max * 0.6 ? cut.slice(0, boundary) : cut).replace(/[\s,;:.\-–—]+$/, '')
}

export function buildExcerpt(excerpt: string | null | undefined, markdown: string, max = 320): string {
  const fromApi = stripMarkdown(String(excerpt ?? ''))
  if (fromApi) return clipText(fromApi, max)
  const firstParagraph = splitMarkdownBlocks(markdown).find((block) => {
    const type: BlockType = analyzeBlocks([block])[0].type
    return type === 'paragraph'
  })
  return clipText(stripMarkdown(firstParagraph ?? markdown), max)
}

export function wordCount(value: string): number {
  const words = stripMarkdown(value).split(/\s+/).filter(Boolean)
  return words.length
}

export function readingTimeFor(content: string): number {
  return Math.max(1, Math.ceil(wordCount(content) / 220))
}

/**
 * Keep whole blocks until the character budget is spent. Always returns at
 * least one block when blocks exist, so a moderator is never handed nothing.
 */
export function capBlocksToBudget(blocks: string[], maxChars: number): string[] {
  const kept: string[] = []
  let total = 0
  for (const block of blocks) {
    const extra = kept.length ? 2 : 0
    if (kept.length && total + extra + block.length > maxChars) break
    kept.push(block)
    total += extra + block.length
  }
  if (!kept.length && blocks.length) return [blocks[0]]
  return kept
}

export type TruncationResult = { content: string; truncated: boolean }

/**
 * Cut Markdown at the nearest paragraph boundary at or before `maxChars`,
 * never inside a table, list, image or fenced code block.
 */
export function truncateMarkdown(markdown: string, maxChars: number): TruncationResult {
  const blocks = splitMarkdownBlocks(markdown)
  if (!blocks.length) return { content: '', truncated: false }
  const infos = analyzeBlocks(blocks)
  const kept: string[] = []
  let total = 0

  for (const info of infos) {
    const extra = kept.length ? 2 : 0
    if (total + extra + info.text.length <= maxChars) {
      kept.push(info.text)
      total += extra + info.text.length
      continue
    }
    if (kept.length === 0) {
      // The very first block is already over budget.
      if (info.type === 'table' || info.type === 'code' || info.type === 'list' || info.type === 'image') {
        return { content: info.text, truncated: infos.length > 1 }
      }
      return { content: cutParagraph(info.text, maxChars), truncated: true }
    }
    break
  }

  return { content: joinBlocks(kept), truncated: kept.length < infos.length }
}

/** Cut inside a single paragraph at a sentence, then word, boundary. */
function cutParagraph(text: string, maxChars: number): string {
  const window = text.slice(0, Math.max(1, maxChars))
  const sentence = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('! '),
    window.lastIndexOf('? '),
    window.lastIndexOf('.\n'),
  )
  if (sentence > maxChars * 0.4) return window.slice(0, sentence + 1).trim()
  const word = window.lastIndexOf(' ')
  const cut = word > 0 ? window.slice(0, word) : window
  return cut.replace(/[\s(\[{*_`]+$/, '').trim()
}

/** Remove image-only blocks and the italic caption line that followed them. */
export function dropImageBlocks(blocks: string[], indices: Set<number>): string[] {
  const drop = new Set(indices)
  for (const index of indices) {
    const next = blocks[index + 1]
    if (next !== undefined && isCaptionBlock(next)) drop.add(index + 1)
  }
  return blocks.filter((_, index) => !drop.has(index))
}

export { isImageOnlyBlock, isCaptionBlock, splitMarkdownBlocks, joinBlocks }
