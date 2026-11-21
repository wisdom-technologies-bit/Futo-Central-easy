/**
 * Runtime configuration for the education-news importer.
 *
 * Every value is read from the environment at request time (never at module
 * load) so a redeploy is not needed to change a limit, and so tests can stub
 * `process.env` per case.
 */

export type ContentMode = 'full' | 'truncated'
export type FailMode = 'open' | 'closed'

export type CloudinaryConfig = {
  cloudName: string
  apiKey: string
  apiSecret: string
}

export type ImportConfig = {
  apiUrl: string
  importSecret: string
  contentMode: ContentMode
  truncateChars: number
  sourceAllowlist: string[]
  titleBlocklist: RegExp
  maxAgeDays: number
  batchSize: number
  timeBudgetMs: number
  maxImages: number
  notify: boolean
  notifyMaxPerRun: number
  notifyMaxAgeHours: number
  groqApiKey: string
  groqModel: string
  groqMaxCharsTotal: number
  groqMaxRemoveRatio: number
  groqFailMode: FailMode
  groqTimeoutMs: number
  cloudinary: CloudinaryConfig | null
}

const DEFAULT_TITLE_BLOCKLIST = 'expo|runz|leaked|free answers'

function str(name: string, fallback = ''): string {
  const value = process.env[name]
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function num(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

function positiveInt(name: string, fallback: number): number {
  const value = Math.floor(num(name, fallback))
  return value > 0 ? value : fallback
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]
  if (raw === undefined) return fallback
  return raw.trim().toLowerCase() === 'true'
}

/** Comma separated source IDs. Empty entries are dropped. */
export function parseAllowlist(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

/** Never throws: an invalid pattern falls back to the documented default. */
export function compileTitleBlocklist(source: string): RegExp {
  try {
    return new RegExp(source, 'i')
  } catch {
    return new RegExp(DEFAULT_TITLE_BLOCKLIST, 'i')
  }
}

export function readCloudinaryConfig(): CloudinaryConfig | null {
  const cloudName = str('CLOUDINARY_CLOUD_NAME')
  const apiKey = str('CLOUDINARY_API_KEY')
  const apiSecret = str('CLOUDINARY_API_SECRET')
  if (!cloudName || !apiKey || !apiSecret) return null
  return { cloudName, apiKey, apiSecret }
}

export function readImportConfig(): ImportConfig {
  const mode = str('IMPORT_CONTENT_MODE', 'truncated').toLowerCase()
  const failMode = str('GROQ_FAIL_MODE', 'closed').toLowerCase()
  return {
    apiUrl: str('EDU_NEWS_API_URL').replace(/\/+$/, ''),
    importSecret: str('IMPORT_SECRET'),
    contentMode: mode === 'full' ? 'full' : 'truncated',
    truncateChars: positiveInt('IMPORT_TRUNCATE_CHARS', 1500),
    sourceAllowlist: parseAllowlist(process.env.IMPORT_SOURCE_ALLOWLIST),
    titleBlocklist: compileTitleBlocklist(str('IMPORT_TITLE_BLOCKLIST', DEFAULT_TITLE_BLOCKLIST)),
    maxAgeDays: positiveInt('IMPORT_MAX_AGE_DAYS', 10),
    batchSize: positiveInt('IMPORT_BATCH_SIZE', 6),
    timeBudgetMs: positiveInt('IMPORT_TIME_BUDGET_MS', 50000),
    maxImages: positiveInt('IMPORT_MAX_IMAGES', 8),
    notify: bool('IMPORT_NOTIFY', false),
    notifyMaxPerRun: positiveInt('IMPORT_NOTIFY_MAX_PER_RUN', 3),
    notifyMaxAgeHours: positiveInt('IMPORT_NOTIFY_MAX_AGE_HOURS', 3),
    groqApiKey: str('GROQ_API_KEY'),
    groqModel: str('GROQ_MODEL', 'llama-3.1-8b-instant'),
    groqMaxCharsTotal: positiveInt('GROQ_MAX_CHARS_TOTAL', 8000),
    groqMaxRemoveRatio: Math.min(1, Math.max(0, num('GROQ_MAX_REMOVE_RATIO', 0.4))),
    groqFailMode: failMode === 'open' ? 'open' : 'closed',
    groqTimeoutMs: positiveInt('GROQ_TIMEOUT_MS', 20000),
    cloudinary: readCloudinaryConfig(),
  }
}

/**
 * Configuration that must be present before a run can start.
 * Returns a human readable message, or null when the run may proceed.
 */
export function findBlockingConfigError(config: ImportConfig): string | null {
  if (!config.importSecret) return 'IMPORT_SECRET is not set, so the importer cannot authenticate callers.'
  if (!config.apiUrl) return 'EDU_NEWS_API_URL is not set, so there is no news API to fetch from.'
  if (config.sourceAllowlist.length === 0)
    return 'IMPORT_SOURCE_ALLOWLIST is empty, so nothing is imported. Add at least one edu-news source ID.'
  if (!config.cloudinary)
    return 'Cloudinary is not configured (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET). Import aborted: hotlinking third-party images is not allowed.'
  if (!config.groqApiKey && config.groqFailMode === 'closed')
    return 'GROQ_API_KEY is not set and GROQ_FAIL_MODE is "closed", so no article can be moderated. Import aborted.'
  return null
}
