import 'server-only'
import { revalidatePath } from 'next/cache'
import type { Pool } from 'pg'
import { withDatabase } from '@/lib/db'
import { notifyDigest, notifyOnce } from '@/lib/news-notify'
import { slugify } from '@/lib/slugify'
import { joinBlocks, splitMarkdownBlocks } from './blocks'
import { buildExcerpt, capBlocksToBudget, cleanMarkdown, clipText, readingTimeFor, truncateMarkdown } from './clean'
import { findBlockingConfigError, readImportConfig, type ImportConfig } from './config'
import { fetchEduNews } from './fetch'
import { planArticleImages, processArticleImages } from './images'
import { applyModeration, precheckArticle, requestModeration } from './moderation'
import type { Candidate, DryRunEntry, DryRunModerationEntry, ImportSummary, SkipReason } from './types'

const CATEGORY_SLUG = 'education-news'
const CATEGORY_NAME = 'Education News'
const AUTHOR_NAME = 'Education Desk'
const SITE_URL = 'https://futocentral.name.ng'
const NOTIFY_HEADING = 'FUTO Central — Education News'
const FUTURE_SLACK_MS = 10 * 60 * 1000
const MIN_CONTENT_CHARS = 300
const DRY_MODERATION_LIMIT = 3

export type DryRunReport = {
  allowlist: string[]
  content_mode: string
  candidates: DryRunEntry[]
  skipped: { external_id: string; title: string; reason: SkipReason }[]
  moderation?: DryRunModerationEntry[]
}

export type ImportRunResult = { summary: ImportSummary; dry?: DryRunReport }

type PreparedArticle = {
  title: string
  originalTitle: string
  slug: string
  excerpt: string
  content: string
  featuredImage: string | null
  featuredImageAlt: string
  readingTime: number
  seoTitle: string
  metaDescription: string
  tags: string[]
  moderation: { model: string; removed_blocks: number; fixed_blocks: number; title_changed: boolean }
  imagePlan: string[]
  imageUploads: number
  imageFailures: number
  dryModeration?: DryRunModerationEntry
}

type PrepareOutcome =
  | { status: 'skip'; reason: SkipReason }
  | { status: 'reject'; reason: string; title: string; dryModeration?: DryRunModerationEntry }
  | { status: 'ready'; article: PreparedArticle }

/* ------------------------------------------------------------------ *
 * Database helpers
 * ------------------------------------------------------------------ */

async function resolveCategoryId(db: Pool): Promise<string> {
  const result = await db.query('SELECT id FROM categories WHERE slug = $1 LIMIT 1', [CATEGORY_SLUG])
  if (!result.rowCount) throw new Error(`CATEGORY_MISSING: expected the "${CATEGORY_NAME}" category (slug ${CATEGORY_SLUG}) to exist`)
  return result.rows[0].id as string
}

async function resolveAuthorId(db: Pool): Promise<string> {
  const found = await db.query('SELECT id FROM authors WHERE name = $1 LIMIT 1', [AUTHOR_NAME])
  if (found.rowCount) return found.rows[0].id as string
  const created = await db.query('INSERT INTO authors (name) VALUES ($1) RETURNING id', [AUTHOR_NAME])
  return created.rows[0].id as string
}

async function upsertTag(db: Pool, name: string): Promise<string | null> {
  const slug = slugify(name)
  if (!slug) return null
  const inserted = await db.query('INSERT INTO tags (name, slug) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id', [name, slug])
  if (inserted.rowCount) return inserted.rows[0].id as string
  const found = await db.query('SELECT id FROM tags WHERE slug = $1 OR name = $2 LIMIT 1', [slug, name])
  return found.rowCount ? (found.rows[0].id as string) : null
}

async function uniqueSlug(db: Pool, base: string): Promise<string> {
  let candidate = base
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const taken = await db.query('SELECT 1 FROM articles WHERE slug = $1 LIMIT 1', [candidate])
    if (!taken.rowCount) return candidate
    candidate = `${base}-${attempt + 2}`
  }
  return `${base}-${Date.now().toString(36)}`
}

async function recordRejection(db: Pool, candidate: Candidate, reason: string) {
  await db.query(
    `INSERT INTO import_rejections (external_id, source_name, title, reason) VALUES ($1, $2, $3, $4) ON CONFLICT (external_id) DO NOTHING`,
    [candidate.externalId, candidate.sourceName, candidate.title.slice(0, 300), reason.slice(0, 60)],
  )
}

/* ------------------------------------------------------------------ *
 * Per-article pipeline: moderate -> clean -> images -> content mode
 * ------------------------------------------------------------------ */

async function prepareArticle(
  candidate: Candidate,
  config: ImportConfig,
  options: { dry: boolean; runGroq: boolean; remainingMs: () => number },
): Promise<PrepareOutcome> {
  const item = candidate.item
  const originalTitle = candidate.title
  const cleaned = cleanMarkdown(String(item.content ?? ''), originalTitle)
  if (cleaned.trim().length < MIN_CONTENT_CHARS) return { status: 'skip', reason: 'content_too_short' }

  const precheck = precheckArticle({ title: originalTitle, content: cleaned, blocklist: config.titleBlocklist, minChars: MIN_CONTENT_CHARS })
  if (precheck) return { status: 'skip', reason: precheck }

  // In truncated mode the moderator only ever sees (and can only approve) the
  // text that will actually be published.
  let blocks =
    config.contentMode === 'truncated'
      ? splitMarkdownBlocks(truncateMarkdown(cleaned, config.truncateChars).content)
      : splitMarkdownBlocks(cleaned)
  blocks = capBlocksToBudget(blocks, config.groqMaxCharsTotal)
  if (!blocks.length) return { status: 'skip', reason: 'missing_content' }

  let title = originalTitle
  let moderation = { model: config.groqModel, removed_blocks: 0, fixed_blocks: 0, title_changed: false }
  let dryModeration: DryRunModerationEntry | undefined

  if (options.runGroq) {
    if (!config.groqApiKey) {
      if (config.groqFailMode === 'closed') return { status: 'skip', reason: 'moderation_unavailable' }
    } else {
      const outcome = await requestModeration({
        title,
        source: candidate.sourceName,
        blocks,
        apiKey: config.groqApiKey,
        model: config.groqModel,
        timeoutMs: config.groqTimeoutMs,
        remainingMs: options.remainingMs,
      })

      if (!outcome.ok) {
        if (config.groqFailMode === 'closed') return { status: 'skip', reason: 'moderation_unavailable' }
        // GROQ_FAIL_MODE=open: heuristic checks above are all the safety we apply.
      } else if (outcome.parsed.verdict === 'reject') {
        return {
          status: 'reject',
          reason: outcome.parsed.reason,
          title: originalTitle,
          dryModeration: options.dry
            ? {
                external_id: candidate.externalId,
                original_title: originalTitle,
                verdict: 'reject',
                reason: outcome.parsed.reason,
                title: originalTitle,
                title_changed: false,
                removed: [],
                accepted_fixes: [],
                ignored_fixes: [],
              }
            : undefined,
        }
      } else {
        const applied = applyModeration({ blocks, title, parsed: outcome.parsed, maxRemoveRatio: config.groqMaxRemoveRatio })
        if (applied.status === 'rejected') {
          return {
            status: 'reject',
            reason: applied.reason,
            title: originalTitle,
            dryModeration: options.dry
              ? {
                  external_id: candidate.externalId,
                  original_title: originalTitle,
                  verdict: 'reject',
                  reason: applied.reason,
                  title: originalTitle,
                  title_changed: false,
                  removed: [],
                  accepted_fixes: [],
                  ignored_fixes: [],
                }
              : undefined,
          }
        }
        blocks = applied.application.blocks
        title = applied.application.title
        moderation = {
          model: outcome.model,
          removed_blocks: applied.application.removedBlocks,
          fixed_blocks: applied.application.fixedBlocks,
          title_changed: applied.application.titleChanged,
        }
        if (options.dry) {
          dryModeration = {
            external_id: candidate.externalId,
            original_title: originalTitle,
            verdict: 'accept',
            reason: outcome.parsed.reason,
            title,
            title_changed: applied.application.titleChanged,
            removed: applied.application.removed,
            accepted_fixes: applied.application.acceptedFixes,
            ignored_fixes: applied.application.ignoredFixes,
          }
        }
      }
    }
  }

  let content = joinBlocks(blocks)
  if (!content.trim()) return { status: 'skip', reason: 'missing_content' }

  let featuredImage: string | null = null
  let imagePlan: string[] = []
  let imageUploads = 0
  let imageFailures = 0

  if (options.dry) {
    imagePlan = planArticleImages(content, item.image_url, config.maxImages).uploads
  } else {
    const images = await processArticleImages({
      content,
      imageUrl: item.image_url,
      title,
      maxImages: config.maxImages,
      cloudinary: config.cloudinary as NonNullable<ImportConfig['cloudinary']>,
    })
    content = images.content
    featuredImage = images.featuredImage
    imagePlan = images.uploaded
    imageUploads = images.uploads
    imageFailures = images.failures
  }

  if (!content.trim()) return { status: 'skip', reason: 'missing_content' }

  const excerpt = buildExcerpt(item.excerpt, content, 320) || clipText(content, 320)
  const tags = Array.from(new Set([String(item.category ?? '').trim(), String(item.institution ?? '').trim()].filter(Boolean)))
  const slugBase = slugify(title) || CATEGORY_SLUG

  return {
    status: 'ready',
    article: {
      title,
      originalTitle,
      slug: `${slugBase}-${candidate.externalId.slice(0, 6)}`,
      excerpt,
      content,
      featuredImage,
      featuredImageAlt: title,
      readingTime: readingTimeFor(content),
      seoTitle: clipText(title, 60),
      metaDescription: clipText(excerpt, 155),
      tags,
      moderation,
      imagePlan,
      imageUploads,
      imageFailures,
      dryModeration,
    },
  }
}

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */

function logSummary(summary: ImportSummary) {
  console.log(
    JSON.stringify({
      event: 'news_import',
      fetched: summary.fetched,
      filtered: summary.filtered,
      rejected_by_ai: summary.rejected_by_ai,
      inserted: summary.inserted,
      skipped: summary.skipped,
      image_uploads: summary.image_uploads,
      image_failures: summary.image_failures,
      notified: summary.notified,
      errors: summary.errors,
      elapsed_ms: summary.elapsed_ms,
      ...(summary.error ? { error: summary.error } : {}),
    }),
  )
}

export async function runNewsImport(options: { dry: boolean; moderate?: boolean }): Promise<ImportRunResult> {
  const startedAt = Date.now()
  const elapsed = () => Date.now() - startedAt
  const config = readImportConfig()
  const summary: ImportSummary = {
    ok: false,
    dry: options.dry,
    fetched: 0,
    filtered: 0,
    rejected_by_ai: 0,
    inserted: 0,
    skipped: 0,
    image_uploads: 0,
    image_failures: 0,
    notified: 0,
    errors: 0,
    elapsed_ms: 0,
  }
  const dryReport: DryRunReport = { allowlist: config.sourceAllowlist, content_mode: config.contentMode, candidates: [], skipped: [] }
  const skippedList: { external_id: string; title: string; reason: SkipReason }[] = []
  const skip = (entry: { external_id: string; title: string }, reason: SkipReason) => {
    skippedList.push({ ...entry, reason })
    summary.skipped += 1
  }

  const finish = (): ImportRunResult => {
    summary.elapsed_ms = elapsed()
    summary.ok = !summary.error
    dryReport.skipped = skippedList
    logSummary(summary)
    return options.dry ? { summary, dry: dryReport } : { summary }
  }

  const blocking = findBlockingConfigError(config)
  if (blocking) {
    summary.error = blocking
    return finish()
  }

  const remainingMs = () => Math.max(0, config.timeBudgetMs - elapsed())

  // First-run detection drives the silent backfill rule.
  let firstRun: boolean
  try {
    const state = await withDatabase(async (db) => {
      const imported = await db.query('SELECT 1 FROM articles WHERE is_imported = true LIMIT 1')
      return { firstRun: !imported.rowCount }
    })
    firstRun = state.firstRun
  } catch (error) {
    summary.error = error instanceof Error ? error.message : 'DATABASE_UNAVAILABLE'
    summary.errors += 1
    return finish()
  }

  const fetched = await fetchEduNews(config)
  if (fetched.error) {
    summary.error = fetched.error
    summary.errors += 1
  }
  summary.fetched = fetched.items.length
  if (!fetched.items.length) return finish()

  const now = Date.now()
  const maxAgeMs = config.maxAgeDays * 24 * 60 * 60 * 1000
  const candidates: Candidate[] = []

  for (const item of fetched.items) {
    const externalId = String(item.id ?? '').trim()
    const title = String(item.title ?? '').trim()
    const entry = { external_id: externalId, title: title.slice(0, 200) }
    if (!externalId || !title) {
      summary.filtered += 1
      skip(entry, 'missing_title')
      continue
    }
    if (config.titleBlocklist.test(title)) {
      summary.filtered += 1
      skip(entry, 'blocklisted_title')
      continue
    }
    const publishedAt = item.published_at ? new Date(item.published_at) : null
    if (!publishedAt || Number.isNaN(publishedAt.getTime())) {
      summary.filtered += 1
      skip(entry, 'too_old')
      continue
    }
    if (publishedAt.getTime() > now + FUTURE_SLACK_MS) {
      summary.filtered += 1
      skip(entry, 'future_dated')
      continue
    }
    if (publishedAt.getTime() < now - maxAgeMs) {
      summary.filtered += 1
      skip(entry, 'too_old')
      continue
    }
    const rawContent = String(item.content ?? '')
    if (!rawContent.trim()) {
      summary.filtered += 1
      skip(entry, 'missing_content')
      continue
    }
    if (rawContent.trim().length < MIN_CONTENT_CHARS) {
      summary.filtered += 1
      skip(entry, 'content_too_short')
      continue
    }
    candidates.push({
      item,
      externalId,
      title,
      sourceName: String(item.source_name ?? '').trim() || CATEGORY_NAME,
      publishedAt,
    })
  }

  // Drop anything already imported or previously rejected.
  let fresh: Candidate[] = candidates
  if (candidates.length) {
    const ids = candidates.map((candidate) => candidate.externalId)
    try {
      const seen = await withDatabase(async (db) => {
        const articles = await db.query('SELECT external_id FROM articles WHERE external_id = ANY($1::text[])', [ids])
        const rejections = await db.query('SELECT external_id FROM import_rejections WHERE external_id = ANY($1::text[])', [ids])
        return {
          articles: new Set(articles.rows.map((row) => row.external_id as string)),
          rejections: new Set(rejections.rows.map((row) => row.external_id as string)),
        }
      })
      fresh = []
      for (const candidate of candidates) {
        if (seen.articles.has(candidate.externalId)) {
          summary.filtered += 1
          skip({ external_id: candidate.externalId, title: candidate.title.slice(0, 200) }, 'duplicate_article')
          continue
        }
        if (seen.rejections.has(candidate.externalId)) {
          summary.filtered += 1
          skip({ external_id: candidate.externalId, title: candidate.title.slice(0, 200) }, 'previously_rejected')
          continue
        }
        fresh.push(candidate)
      }
    } catch (error) {
      summary.error = error instanceof Error ? error.message : 'DATABASE_UNAVAILABLE'
      summary.errors += 1
      return finish()
    }
  }

  fresh.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())

  const notifySilently = firstRun || !config.notify
  const notifyWindowMs = config.notifyMaxAgeHours * 60 * 60 * 1000
  const inserted: { id: string; slug: string; title: string; image: string | null; notify: boolean }[] = []
  let dryGroqCalls = 0

  for (const candidate of fresh) {
    if (summary.inserted >= config.batchSize) break
    if (remainingMs() < 5000) {
      skip({ external_id: candidate.externalId, title: candidate.title.slice(0, 200) }, 'out_of_budget')
      continue
    }

    const runGroq = options.dry ? Boolean(options.moderate) && dryGroqCalls < DRY_MODERATION_LIMIT : true
    if (options.dry && runGroq) dryGroqCalls += 1

    let prepared: PrepareOutcome
    try {
      prepared = await prepareArticle(candidate, config, { dry: options.dry, runGroq, remainingMs })
    } catch (error) {
      summary.errors += 1
      skip({ external_id: candidate.externalId, title: candidate.title.slice(0, 200) }, 'insert_failed')
      console.error('[v0] news import prepare failed:', error instanceof Error ? error.message : 'unknown')
      continue
    }

    if (prepared.status === 'skip') {
      skip({ external_id: candidate.externalId, title: candidate.title.slice(0, 200) }, prepared.reason)
      continue
    }

    if (prepared.status === 'reject') {
      summary.rejected_by_ai += 1
      if (prepared.dryModeration) {
        dryReport.moderation = [...(dryReport.moderation ?? []), prepared.dryModeration]
      } else {
        try {
          await withDatabase((db) => recordRejection(db, candidate, prepared.reason))
        } catch (error) {
          summary.errors += 1
          console.error('[v0] news import rejection record failed:', error instanceof Error ? error.message : 'unknown')
        }
      }
      continue
    }

    const article = prepared.article
    summary.image_uploads += article.imageUploads
    summary.image_failures += article.imageFailures
    if (article.dryModeration) dryReport.moderation = [...(dryReport.moderation ?? []), article.dryModeration]

    if (options.dry) {
      dryReport.candidates.push({
        external_id: candidate.externalId,
        title: article.title,
        slug: article.slug,
        category: CATEGORY_NAME,
        published_at: candidate.publishedAt.toISOString(),
        source_name: candidate.sourceName,
        content_mode: config.contentMode,
        content_chars: article.content.length,
        images: article.imagePlan,
        tags: article.tags,
      })
      summary.inserted += 1
      continue
    }

    const notify = !notifySilently && now - candidate.publishedAt.getTime() <= notifyWindowMs
    try {
      const row = await withDatabase(async (db) => {
        const categoryId = await resolveCategoryId(db)
        const authorId = await resolveAuthorId(db)
        const slug = await uniqueSlug(db, article.slug)
        const result = await db.query(
          `INSERT INTO articles (title, slug, excerpt, content, category_id, author_id, featured_image, featured_image_alt, status, published_at, reading_time, seo_title, meta_description, is_featured, is_imported, external_id, source_name, source_url, original_title, moderation, notification_sent_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'published',$9,$10,$11,$12,false,true,$13,$14,$15,$16,$17::jsonb, CASE WHEN $18::boolean THEN NOW() ELSE NULL END)
           ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO NOTHING
           RETURNING id, slug`,
          [
            article.title,
            slug,
            article.excerpt,
            article.content,
            categoryId,
            authorId,
            article.featuredImage,
            article.featuredImageAlt,
            candidate.publishedAt.toISOString(),
            article.readingTime,
            article.seoTitle,
            article.metaDescription,
            candidate.externalId,
            candidate.sourceName,
            String(candidate.item.source_url ?? '') || null,
            article.originalTitle,
            JSON.stringify(article.moderation),
            !notify,
          ],
        )
        if (!result.rowCount) return null
        const articleId = result.rows[0].id as string
        for (const tag of article.tags) {
          const tagId = await upsertTag(db, tag)
          if (tagId) await db.query('INSERT INTO article_tags (article_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [articleId, tagId])
        }
        return { id: articleId, slug: result.rows[0].slug as string }
      })

      if (!row) {
        // Raced with another run: the row already exists.
        skip({ external_id: candidate.externalId, title: candidate.title.slice(0, 200) }, 'duplicate_article')
        continue
      }
      summary.inserted += 1
      inserted.push({ id: row.id, slug: row.slug, title: article.title, image: article.featuredImage, notify })
    } catch (error) {
      summary.errors += 1
      skip({ external_id: candidate.externalId, title: candidate.title.slice(0, 200) }, 'insert_failed')
      console.error('[v0] news import insert failed:', error instanceof Error ? error.message : 'unknown')
    }
  }

  // Notifications last, and never fatal to the import.
  const notifyTargets = inserted.filter((entry) => entry.notify)
  if (notifyTargets.length) {
    try {
      if (notifyTargets.length <= config.notifyMaxPerRun) {
        for (const target of notifyTargets) {
          const sent = await notifyOnce(
            target.id,
            { title: target.title, slug: target.slug, image: target.image ?? undefined },
            { heading: NOTIFY_HEADING, message: target.title, url: `${SITE_URL}/news/${target.slug}` },
          )
          if (sent) summary.notified += 1
        }
      } else {
        const sent = await notifyDigest(
          notifyTargets.map((target) => target.id),
          { heading: NOTIFY_HEADING, message: `${notifyTargets.length} new education stories`, url: `${SITE_URL}/news/${CATEGORY_SLUG}` },
        )
        if (sent) summary.notified += notifyTargets.length
      }
    } catch (error) {
      summary.errors += 1
      console.error('[v0] news import notification failed:', error instanceof Error ? error.message : 'unknown')
    }
  }

  if (!options.dry) {
    for (const path of ['/', '/news', '/rss.xml', '/sitemap.xml']) {
      try {
        revalidatePath(path)
      } catch {
        // Route may not exist in this build; nothing to revalidate.
      }
    }
  }

  return finish()
}
