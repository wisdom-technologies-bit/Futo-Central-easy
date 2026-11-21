import { describe, expect, it } from 'vitest'
import { analyzeBlocks } from './blocks'
import { applyModeration, checkFix, parseModerationOutput, precheckArticle, shouldAcceptTitle, titleSimilarity, type ParsedModeration } from './moderation'

const PARAGRAPH =
  'The National Universities Commission has aproved a new accreditation for the university after a review of facilities.'
const SECOND_PARAGRAPH = 'The commission said the approval followed a review of staffing in the faculty of engineering.'
const TABLE = '| Faculty | Programme | Duration | Status |\n| --- | --- | --- | --- |\n| Engineering | Civil | 5 years | Accredited |'
const CODE = '```ts\nconst accredited = true\n```'
const IMAGE = '![Convocation hall](https://news.example.com/images/hall.jpg)'
const THIRD_PARAGRAPH = 'Students should note the deadline published by the registry.'

const BLOCKS = [PARAGRAPH, SECOND_PARAGRAPH, CODE, TABLE, IMAGE, THIRD_PARAGRAPH]

function parsed(overrides: Partial<ParsedModeration> = {}): ParsedModeration {
  return { verdict: 'accept', reason: 'other', title: null, remove: [], fixes: [], ...overrides }
}

describe('parseModerationOutput', () => {
  it('accepts fenced JSON and normalises the reason', () => {
    const result = parseModerationOutput('```json\n{"verdict":"reject","reason":"EXPO","remove":[1],"fixes":[]}\n```')
    expect(result).not.toBeNull()
    expect(result?.verdict).toBe('reject')
    expect(result?.reason).toBe('expo')
    expect(result?.remove).toEqual([1])
  })

  it('returns null for unusable output', () => {
    expect(parseModerationOutput('I think this article is fine.')).toBeNull()
    expect(parseModerationOutput('{"verdict":"maybe"}')).toBeNull()
    expect(parseModerationOutput('{"verdict":"accept","remove":"all"}')).toBeNull()
  })
})

describe('checkFix', () => {
  it('accepts a small typo repair', () => {
    const fixed = PARAGRAPH.replace('aproved', 'approved')
    expect(checkFix(PARAGRAPH, fixed)).toEqual({ ok: true })
  })

  it('rejects a paraphrase attempt', () => {
    const paraphrased = 'The commission approved fresh accreditation for the varsity following a facilities review.'
    const result = checkFix(PARAGRAPH, paraphrased)
    expect(result.ok).toBe(false)
    expect(result).toEqual({ ok: false, reason: 'paraphrased' })
  })

  it('rejects a number change', () => {
    const original = 'The commission accredited 150 programmes across the faculty of engineering this session.'
    const fixed = 'The commission accredited 200 programmes across the faculty of engineering this session.'
    expect(checkFix(original, fixed)).toEqual({ ok: false, reason: 'numbers_changed' })
  })

  it('rejects a URL change', () => {
    const original = 'Applicants should check the portal at https://portal.example.edu.ng for the admission list.'
    const fixed = 'Applicants should check the portal at https://portal.example.edu.ng/admissions for the admission list.'
    expect(checkFix(original, fixed)).toEqual({ ok: false, reason: 'urls_changed' })
  })

  it('rejects a changed name and a changed leading marker', () => {
    const original = 'Prof. Ada Nwosu will address students at the convocation arena on Monday morning.'
    const renamed = 'Prof. Ada Nwoke will address students at the convocation arena on Monday morning.'
    expect(checkFix(original, renamed)).toEqual({ ok: false, reason: 'names_changed' })
    expect(checkFix('- First point about the deadline', 'Second point about the deadline')).toEqual({ ok: false, reason: 'marker_changed' })
  })
})

describe('title similarity guard', () => {
  it('keeps a title that only lost the site suffix', () => {
    const original = 'FUTO announces new academic session updates | Punch'
    const cleaned = 'FUTO announces new academic session updates'
    expect(titleSimilarity(original, cleaned)).toBeGreaterThan(0.8)
    expect(shouldAcceptTitle(original, cleaned)).toBe(true)
  })

  it('rejects a rewritten headline', () => {
    const original = 'FUTO announces new academic session updates'
    expect(shouldAcceptTitle(original, 'Everything you need to know about campus life')).toBe(false)
    expect(shouldAcceptTitle(original, '')).toBe(false)
    expect(shouldAcceptTitle(original, 'x'.repeat(201))).toBe(false)
  })
})

describe('applyModeration', () => {
  it('rejects the article when too many text blocks would be deleted', () => {
    const outcome = applyModeration({ blocks: BLOCKS, title: 'Accreditation update', parsed: parsed({ remove: [0, 1, 5] }), maxRemoveRatio: 0.4 })
    expect(outcome).toEqual({ status: 'rejected', reason: 'gibberish' })
  })

  it('never removes or edits image, table or code blocks', () => {
    const outcome = applyModeration({
      blocks: BLOCKS,
      title: 'Accreditation update',
      parsed: parsed({
        remove: [2, 3, 4],
        fixes: [
          { i: 2, text: '```ts\nconst accredited = false\n```' },
          { i: 3, text: TABLE.replace('Accredited', 'Pending') },
          { i: 4, text: '![Convocation hall](https://news.example.com/images/hall2.jpg)' },
        ],
      }),
      maxRemoveRatio: 0.4,
    })
    expect(outcome.status).toBe('accepted')
    if (outcome.status !== 'accepted') return
    expect(outcome.application.blocks).toEqual(BLOCKS)
    expect(outcome.application.removedBlocks).toBe(0)
    expect(outcome.application.fixedBlocks).toBe(0)
    expect(outcome.application.ignoredFixes.map((fix) => fix.reason)).toEqual(['ineligible_block', 'ineligible_block', 'ineligible_block'])
  })

  it('applies an accepted typo fix and ignores a paraphrase', () => {
    const outcome = applyModeration({
      blocks: BLOCKS,
      title: 'Accreditation update',
      parsed: parsed({
        fixes: [
          { i: 0, text: PARAGRAPH.replace('aproved', 'approved') },
          { i: 1, text: 'The regulator approved the faculty after checking its staffing levels.' },
        ],
      }),
      maxRemoveRatio: 0.4,
    })
    expect(outcome.status).toBe('accepted')
    if (outcome.status !== 'accepted') return
    expect(outcome.application.fixedBlocks).toBe(1)
    expect(outcome.application.blocks[0]).toContain('approved a new accreditation')
    expect(outcome.application.ignoredFixes).toHaveLength(1)
    expect(outcome.application.ignoredFixes[0].reason).toBe('paraphrased')
  })

  it('keeps the original title when the model rewrites it', () => {
    const outcome = applyModeration({
      blocks: BLOCKS,
      title: 'NUC accredits engineering programmes at FUTO',
      parsed: parsed({ title: 'A completely different headline about campus sports' }),
      maxRemoveRatio: 0.4,
    })
    expect(outcome.status).toBe('accepted')
    if (outcome.status !== 'accepted') return
    expect(outcome.application.title).toBe('NUC accredits engineering programmes at FUTO')
    expect(outcome.application.titleChanged).toBe(false)
  })

  it('drops a junk title suffix', () => {
    const outcome = applyModeration({
      blocks: BLOCKS,
      title: 'NUC accredits engineering programmes at FUTO | Vanguard',
      parsed: parsed({ title: 'NUC accredits engineering programmes at FUTO' }),
      maxRemoveRatio: 0.4,
    })
    if (outcome.status !== 'accepted') throw new Error('expected accepted')
    expect(outcome.application.title).toBe('NUC accredits engineering programmes at FUTO')
    expect(outcome.application.titleChanged).toBe(true)
  })
})

describe('block classification', () => {
  it('marks only plain text blocks as eligible', () => {
    const types = analyzeBlocks(BLOCKS).map((block) => block.type)
    expect(types).toEqual(['paragraph', 'paragraph', 'code', 'table', 'image', 'paragraph'])
    expect(analyzeBlocks(BLOCKS).map((block) => block.eligible)).toEqual([true, true, false, false, false, true])
  })
})

describe('precheckArticle', () => {
  const longContent = PARAGRAPH.repeat(4)

  it('blocks expo titles before any model call', () => {
    expect(precheckArticle({ title: 'FUTO expo leaked questions', content: longContent, blocklist: /expo|runz|leaked|free answers/i })).toBe('blocklisted_title')
  })

  it('rejects content that is too short', () => {
    expect(precheckArticle({ title: 'Accreditation update', content: 'Too short.', blocklist: /expo/i })).toBe('content_too_short')
  })

  it('passes a normal story', () => {
    expect(precheckArticle({ title: 'Accreditation update', content: longContent, blocklist: /expo|runz/i })).toBeNull()
  })
})
