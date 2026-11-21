/** Shapes returned by the edu-news API and used internally by the importer. */

export type EduNewsItem = {
  id: string
  title: string
  excerpt?: string | null
  content?: string | null
  source_name?: string | null
  source_url?: string | null
  image_url?: string | null
  published_at?: string | null
  category?: string | null
  institution?: string | null
  country?: string | null
  original_language?: string | null
  is_verified?: boolean | null
}

export type EduNewsPage = {
  meta?: { total?: number; has_more?: boolean; page?: number; limit?: number }
  data?: EduNewsItem[]
}

export type SkipReason =
  | 'blocklisted_title'
  | 'too_old'
  | 'future_dated'
  | 'missing_title'
  | 'missing_content'
  | 'content_too_short'
  | 'duplicate_article'
  | 'previously_rejected'
  | 'gibberish'
  | 'ai_rejected'
  | 'moderation_unavailable'
  | 'image_processing_failed'
  | 'insert_failed'
  | 'out_of_budget'

export type Candidate = {
  item: EduNewsItem
  externalId: string
  title: string
  sourceName: string
  publishedAt: Date
}

export type DryRunEntry = {
  external_id: string
  title: string
  slug: string
  category: string
  published_at: string
  source_name: string
  content_mode: string
  content_chars: number
  images: string[]
  tags: string[]
}

export type DryRunModerationEntry = {
  external_id: string
  original_title: string
  verdict: 'accept' | 'reject' | 'unavailable'
  reason: string
  title: string
  title_changed: boolean
  removed: { i: number; text: string }[]
  accepted_fixes: { i: number; before: string; after: string }[]
  ignored_fixes: { i: number; text: string; reason: string }[]
}

export type ImportSummary = {
  ok: boolean
  dry: boolean
  error?: string
  fetched: number
  filtered: number
  rejected_by_ai: number
  inserted: number
  skipped: number
  image_uploads: number
  image_failures: number
  notified: number
  errors: number
  elapsed_ms: number
}
