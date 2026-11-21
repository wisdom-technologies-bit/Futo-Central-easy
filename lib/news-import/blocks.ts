/**
 * Markdown block analysis shared by the cleaner, the moderator and the
 * truncator. Everything here is pure and synchronous so it can be unit tested
 * without network or database access.
 */

export type BlockType = 'paragraph' | 'heading' | 'list' | 'quote' | 'image' | 'table' | 'code' | 'html'

export type BlockInfo = {
  i: number
  text: string
  type: BlockType
  /** Plain text blocks are the only ones the AI may remove or rewrite. */
  eligible: boolean
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/

/**
 * Split Markdown on blank lines, keeping fenced code blocks (which may contain
 * blank lines) in one piece.
 */
export function splitMarkdownBlocks(markdown: string): string[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const blocks: string[] = []
  let current: string[] = []
  let fence: string | null = null

  const flush = () => {
    if (current.length) {
      const text = current.join('\n').trim()
      if (text) blocks.push(text)
      current = []
    }
  }

  for (const line of lines) {
    const fenceMatch = line.match(FENCE)
    if (fence) {
      current.push(line)
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null
      continue
    }
    if (fenceMatch) {
      fence = fenceMatch[1]
      current.push(line)
      continue
    }
    if (!line.trim()) {
      flush()
      continue
    }
    current.push(line)
  }
  flush()
  return blocks
}

export function classifyBlock(text: string): BlockType {
  const trimmed = text.trim()
  if (!trimmed) return 'paragraph'
  if (FENCE.test(trimmed)) return 'code'
  if (/^<[a-zA-Z!/?]/.test(trimmed)) return 'html'
  if (trimmed.startsWith('|')) return 'table'
  if (/^#{1,6}\s/.test(trimmed)) return 'heading'
  if (/^>\s?/.test(trimmed)) return 'quote'
  if (isImageOnlyBlock(trimmed)) return 'image'
  if (/^(\s*(?:[-*+]|\d+[.)])\s+)/.test(trimmed)) return 'list'
  return 'paragraph'
}

export function isImageOnlyBlock(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  const withoutImages = trimmed
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/\s+/g, '')
  return withoutImages === '' && /!\[[^\]]*\]\([^)]*\)|<img\b/i.test(trimmed)
}

/** A caption line is a paragraph that is only emphasis. */
export function isCaptionBlock(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > 400) return false
  return /^(<em>[\s\S]*<\/em>|<i>[\s\S]*<\/i>|\*[^*\n][\s\S]*\*|_[^_\n][\s\S]*_)$/.test(trimmed)
}

export function isPlainTextBlock(type: BlockType): boolean {
  return type === 'paragraph' || type === 'heading' || type === 'list'
}

export function analyzeBlocks(blocks: string[]): BlockInfo[] {
  return blocks.map((text, i) => {
    const type = classifyBlock(text)
    return { i, text, type, eligible: isPlainTextBlock(type) }
  })
}

export function joinBlocks(blocks: string[]): string {
  return blocks
    .map((block) => block.trim())
    .filter(Boolean)
    .join('\n\n')
}

/** The leading Markdown marker of a block ("## ", "- ", "1. ", "> "). */
export function leadingMarker(text: string): string {
  const match = text.match(/^(\s*(?:#{1,6}|[-*+]|\d+[.)]|>)\s*)/)
  return match ? match[1] : ''
}

/**
 * Longest repeated-character run. Used by the cheap gibberish heuristic.
 */
export function longestCharRun(text: string): number {
  let best = 1
  let run = 1
  for (let i = 1; i < text.length; i += 1) {
    if (text[i] === text[i - 1]) {
      run += 1
      if (run > best) best = run
    } else {
      run = 1
    }
  }
  return best
}

/**
 * Cheap, conservative pre-check so obviously broken text never costs a Groq
 * request. Only extreme cases trip it.
 */
export function looksLikeGibberish(text: string): boolean {
  const visible = text.replace(/\s+/g, '')
  if (visible.length < 40) return false
  const letters = (visible.match(/[A-Za-z]/g) ?? []).length
  if (1 - letters / visible.length > 0.45) return true
  if (longestCharRun(visible) >= 8) return true
  return false
}
