/**
 * Groq moderation with code-side enforcement.
 *
 * The model is allowed to make three kinds of suggestion: reject the article,
 * delete blocks, and repair typos. Every suggestion is re-checked here against
 * deterministic rules, because a model that paraphrases or invents facts must
 * never reach the database. All validation helpers are pure so they can be unit
 * tested without network access.
 */

import { z } from 'zod'
import { analyzeBlocks, isPlainTextBlock, leadingMarker, looksLikeGibberish } from './blocks'
import { normalizeForCompare } from './clean'
import { MODERATION_REJECT_REASONS, MODERATION_SYSTEM_PROMPT, type ModerationRejectReason } from './moderation-prompt'

export type ParsedModeration = {
  verdict: 'accept' | 'reject'
  reason: ModerationRejectReason
  title: string | null
  remove: number[]
  fixes: { i: number; text: string }[]
}

const moderationSchema = z.object({
  verdict: z.enum(['accept', 'reject']),
  reason: z.string().max(200).optional(),
  title: z.string().max(400).optional(),
  remove: z.array(z.number().int().min(0)).max(500).optional(),
  fixes: z.array(z.object({ i: z.number().int().min(0), text: z.string().max(100000) })).max(500).optional(),
})

/** Strip ``` fences some models add around JSON. */
function stripFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```[a-zA-Z]*\s*/, '')
    .replace(/```\s*$/, '')
    .trim()
}

/**
 * Defensive parse. Returns null for anything that is not a usable moderation
 * object, which the caller treats as a Groq failure.
 */
export function parseModerationOutput(raw: unknown): ParsedModeration | null {
  let candidate: unknown = raw
  if (typeof raw === 'string') {
    const cleaned = stripFences(raw)
    if (!cleaned.startsWith('{')) return null
    try {
      candidate = JSON.parse(cleaned)
    } catch {
      return null
    }
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null
  const parsed = moderationSchema.safeParse(candidate)
  if (!parsed.success) return null
  const value = parsed.data
  const reasonText = (value.reason ?? '').toLowerCase().trim()
  const reason: ModerationRejectReason = (MODERATION_REJECT_REASONS as readonly string[]).includes(reasonText)
    ? (reasonText as ModerationRejectReason)
    : 'other'
  return {
    verdict: value.verdict,
    reason,
    title: typeof value.title === 'string' && value.title.trim() ? value.title.trim() : null,
    remove: Array.from(new Set(value.remove ?? [])),
    fixes: value.fixes ?? [],
  }
}

/* ------------------------------------------------------------------ *
 * Distance helpers
 * ------------------------------------------------------------------ */

function editDistance<T>(a: T[], b: T[]): number {
  if (!a.length) return b.length
  if (!b.length) return a.length
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  let current = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
    }
    const swap = previous
    previous = current
    current = swap
  }
  return previous[b.length]
}

function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9'’\-]+/g) ?? []
}

/** 0..1 similarity between two titles after normalisation. */
export function titleSimilarity(a: string, b: string): number {
  const left = normalizeForCompare(a)
  const right = normalizeForCompare(b)
  const longest = Math.max(left.length, right.length)
  if (longest === 0) return 1
  return 1 - editDistance(left.split(''), right.split('')) / longest
}

/** A model title is only kept when it is still recognisably the same headline. */
export function shouldAcceptTitle(original: string, candidate: string | null, minSimilarity = 0.8): boolean {
  if (!candidate) return false
  const trimmed = candidate.trim()
  if (!trimmed || trimmed.length > 200) return false
  return titleSimilarity(original, trimmed) >= minSimilarity
}

/* ------------------------------------------------------------------ *
 * Invariant extraction: numbers, URLs, quotes and names must survive a fix
 * ------------------------------------------------------------------ */

function sortedJoin(values: string[]): string {
  return [...values].sort().join('\u0000')
}

function numbersOf(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)*/g) ?? []).map((value) => value.replace(/,/g, ''))
}

function urlsOf(text: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(/https?:\/\/[^\s<>)"'\]]+/g)) found.push(match[0].replace(/[.,;:]+$/, ''))
  for (const match of text.matchAll(/\]\(\s*([^)\s]+)/g)) found.push(match[1])
  return found
}

function quotesOf(text: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(/"[^"\n]{0,400}"|“[^”\n]{0,400}”|'[^'\n]{0,400}'/g)) {
    found.push(match[0].replace(/^[“”"']|[“”"']$/g, '').trim().toLowerCase())
  }
  return found
}

function capitalisedOf(text: string): string[] {
  return (text.match(/\b[A-Z][a-zA-Z'’\-]*/g) ?? []).map((value) => value.toLowerCase())
}

export type FixCheck = { ok: true } | { ok: false; reason: string }

/**
 * Accept a model "fix" only when it is provably a minimal typo repair.
 */
export function checkFix(original: string, fixed: string, maxWordEditRatio = 0.12): FixCheck {
  if (!original.trim() || !fixed.trim()) return { ok: false, reason: 'empty_block' }
  if (leadingMarker(original) !== leadingMarker(fixed)) return { ok: false, reason: 'marker_changed' }

  const originalWords = wordsOf(original)
  const fixedWords = wordsOf(fixed)
  const allowed = maxWordEditRatio * originalWords.length
  if (editDistance(originalWords, fixedWords) > allowed) return { ok: false, reason: 'paraphrased' }

  if (sortedJoin(numbersOf(original)) !== sortedJoin(numbersOf(fixed))) return { ok: false, reason: 'numbers_changed' }
  if (sortedJoin(urlsOf(original)) !== sortedJoin(urlsOf(fixed))) return { ok: false, reason: 'urls_changed' }
  if (sortedJoin(quotesOf(original)) !== sortedJoin(quotesOf(fixed))) return { ok: false, reason: 'quotes_changed' }
  if (sortedJoin(capitalisedOf(original)) !== sortedJoin(capitalisedOf(fixed))) return { ok: false, reason: 'names_changed' }

  const lengthRatio = fixed.length / original.length
  if (lengthRatio < 0.9 || lengthRatio > 1.1) return { ok: false, reason: 'length_changed' }

  // A paragraph must never be turned into an image, table or code fence.
  if (/(!\[[^\]]*\]\(|<img\b|```)/i.test(fixed) && !/(!\[[^\]]*\]\(|<img\b|```)/i.test(original)) {
    return { ok: false, reason: 'introduced_markup' }
  }

  return { ok: true }
}

/* ------------------------------------------------------------------ *
 * Applying the model output
 * ------------------------------------------------------------------ */

export type ModerationApplication = {
  blocks: string[]
  title: string
  titleChanged: boolean
  removed: { i: number; text: string }[]
  acceptedFixes: { i: number; before: string; after: string }[]
  ignoredFixes: { i: number; text: string; reason: string }[]
  removedBlocks: number
  fixedBlocks: number
}

export type ApplyOutcome = { status: 'rejected'; reason: ModerationRejectReason } | { status: 'accepted'; application: ModerationApplication }

/**
 * Enforce the moderation rules. Returns a rejection when the model wants to
 * delete more than `maxRemoveRatio` of the plain text blocks, otherwise the
 * filtered blocks and a record of what was applied and ignored.
 */
export function applyModeration(input: {
  blocks: string[]
  title: string
  parsed: ParsedModeration
  maxRemoveRatio: number
  maxWordEditRatio?: number
}): ApplyOutcome {
  const { blocks, title, parsed } = input
  const infos = analyzeBlocks(blocks)
  const eligible = infos.filter((info) => info.eligible)
  const eligibleIndices = new Set(eligible.map((info) => info.i))

  const removeIndices = parsed.remove.filter((index) => eligibleIndices.has(index))
  const removedRatio = eligible.length ? removeIndices.length / eligible.length : 0
  if (removeIndices.length > 0 && removedRatio > input.maxRemoveRatio) {
    return { status: 'rejected', reason: 'gibberish' }
  }

  const removeSet = new Set(removeIndices)
  const fixByIndex = new Map<number, string>()
  const acceptedFixes: ModerationApplication['acceptedFixes'] = []
  const ignoredFixes: ModerationApplication['ignoredFixes'] = []

  for (const fix of parsed.fixes) {
    const info = infos[fix.i]
    if (!info || !isPlainTextBlock(info.type)) {
      ignoredFixes.push({ i: fix.i, text: fix.text.slice(0, 200), reason: 'ineligible_block' })
      continue
    }
    if (removeSet.has(fix.i)) continue
    if (fixByIndex.has(fix.i)) continue
    const check = checkFix(info.text, fix.text, input.maxWordEditRatio)
    if (!check.ok) {
      ignoredFixes.push({ i: fix.i, text: fix.text.slice(0, 200), reason: check.reason })
      continue
    }
    fixByIndex.set(fix.i, fix.text)
    acceptedFixes.push({ i: fix.i, before: info.text, after: fix.text })
  }

  const keptBlocks: string[] = []
  const removed: ModerationApplication['removed'] = []
  for (const info of infos) {
    if (removeSet.has(info.i)) {
      removed.push({ i: info.i, text: info.text.slice(0, 200) })
      continue
    }
    keptBlocks.push(fixByIndex.get(info.i) ?? info.text)
  }

  const nextTitle = shouldAcceptTitle(title, parsed.title) ? (parsed.title as string).trim() : title

  return {
    status: 'accepted',
    application: {
      blocks: keptBlocks,
      title: nextTitle,
      titleChanged: nextTitle !== title,
      removed,
      acceptedFixes,
      ignoredFixes,
      removedBlocks: removed.length,
      fixedBlocks: acceptedFixes.length,
    },
  }
}

/* ------------------------------------------------------------------ *
 * Cheap pre-checks (no network)
 * ------------------------------------------------------------------ */

export type PrecheckSkip = 'blocklisted_title' | 'missing_title' | 'content_too_short' | 'gibberish'

export function precheckArticle(input: { title: string; content: string; blocklist: RegExp; minChars?: number }): PrecheckSkip | null {
  const title = input.title.trim()
  if (!title) return 'missing_title'
  if (input.blocklist.test(title)) return 'blocklisted_title'
  if (input.content.trim().length < (input.minChars ?? 300)) return 'content_too_short'
  const sample = `${title}\n${input.content.slice(0, 800)}`
  if (looksLikeGibberish(sample)) return 'gibberish'
  return null
}

/* ------------------------------------------------------------------ *
 * Network
 * ------------------------------------------------------------------ */

export type GroqFailure = 'no_key' | 'timeout' | 'rate_limited' | 'http' | 'invalid_output' | 'network' | 'budget'

export type GroqOutcome =
  | { ok: true; parsed: ParsedModeration; model: string }
  | { ok: false; failure: GroqFailure; status?: number }

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'
const MAX_RETRY_SLEEP_MS = 20000

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function retryAfterMs(header: string | null): number {
  if (!header) return 1000
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(header)
  if (Number.isFinite(date)) return Math.max(0, date - Date.now())
  return 1000
}

export type ModerationRequest = {
  title: string
  source: string
  blocks: string[]
  apiKey: string
  model: string
  timeoutMs: number
  /** Milliseconds left in the run budget, when known. */
  remainingMs?: () => number
}

/**
 * One compact request per article. Retries once on 429 (honouring Retry-After,
 * capped at 20s) and never logs the article text.
 */
export async function requestModeration(request: ModerationRequest): Promise<GroqOutcome> {
  if (!request.apiKey) return { ok: false, failure: 'no_key' }

  const payload = {
    model: request.model,
    temperature: 0,
    max_tokens: 1200,
    response_format: { type: 'json_object' as const },
    messages: [
      { role: 'system', content: MODERATION_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify({ title: request.title, source: request.source, blocks: request.blocks.map((text, i) => ({ i, text })) }) },
    ],
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const remaining = request.remainingMs?.()
    if (typeof remaining === 'number' && remaining <= 2000) return { ok: false, failure: 'budget' }
    const timeout = Math.max(2000, Math.min(request.timeoutMs, typeof remaining === 'number' ? remaining - 1000 : request.timeoutMs))

    let response: Response
    try {
      response = await fetch(GROQ_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${request.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store',
        signal: AbortSignal.timeout(timeout),
      })
    } catch (error) {
      const name = error instanceof Error ? error.name : ''
      if (name === 'TimeoutError' || name === 'AbortError') return { ok: false, failure: 'timeout' }
      return { ok: false, failure: 'network' }
    }

    if (response.status === 429) {
      if (attempt === 0) {
        const wait = Math.min(retryAfterMs(response.headers.get('retry-after')), MAX_RETRY_SLEEP_MS)
        const budget = request.remainingMs?.()
        if (typeof budget === 'number' && budget - wait < 2000) return { ok: false, failure: 'rate_limited', status: 429 }
        await sleep(wait)
        continue
      }
      return { ok: false, failure: 'rate_limited', status: 429 }
    }

    if (!response.ok) return { ok: false, failure: 'http', status: response.status }

    let body: unknown
    try {
      body = await response.json()
    } catch {
      return { ok: false, failure: 'invalid_output', status: response.status }
    }

    const content = (body as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content
    const parsed = parseModerationOutput(content)
    if (!parsed) return { ok: false, failure: 'invalid_output', status: response.status }
    return { ok: true, parsed, model: request.model }
  }

  return { ok: false, failure: 'rate_limited' }
}
