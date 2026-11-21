import { describe, expect, it, vi } from 'vitest'
import { findHotlinkedImages, planArticleImages, processArticleImages } from './images'

vi.mock('./cloudinary', async () => {
  const actual = await vi.importActual<typeof import('./cloudinary')>('./cloudinary')
  return {
    ...actual,
    uploadRemoteImage: vi.fn(async (url: string) => {
      if (url.includes('broken')) throw new Error('CLOUDINARY_UPLOAD_400')
      return { secureUrl: `https://res.cloudinary.com/demo/image/upload/f_auto,q_auto/v1/futo-central/news/imported/${url.length}`, publicId: 'futo-central/news/imported/x' }
    }),
  }
})

const cloudinary = { cloudName: 'demo', apiKey: 'key', apiSecret: 'secret' }

describe('planArticleImages', () => {
  it('skips data URIs, tracking pixels and non-http URLs', () => {
    const content = [
      '![One](data:image/gif;base64,R0lGODlhAQABAAAAACw=)',
      '![Two](https://news.example.com/1x1.gif)',
      '![Three](/relative/image.jpg)',
      '![Four](https://news.example.com/real.jpg)',
    ].join('\n\n')
    const plan = planArticleImages(content, null, 8)
    expect(plan.uploads).toEqual(['https://news.example.com/real.jpg'])
    expect(plan.skipped).toHaveLength(3)
  })

  it('counts the featured image first and respects the cap', () => {
    const content = ['![A](https://news.example.com/a.jpg)', '![B](https://news.example.com/b.jpg)'].join('\n\n')
    const plan = planArticleImages(content, 'https://news.example.com/featured.jpg', 2)
    expect(plan.uploads).toEqual(['https://news.example.com/featured.jpg', 'https://news.example.com/a.jpg'])
  })
})

describe('processArticleImages', () => {
  it('rewrites every image through Cloudinary and leaves no hotlink', async () => {
    const content = [
      'The commission approved the programme.',
      '![Convocation hall](https://news.example.com/hall.jpg)',
      '*The convocation hall in Owerri.*',
      '![Second photo](https://news.example.com/second.jpg)',
    ].join('\n\n')

    const result = await processArticleImages({ content, imageUrl: 'https://news.example.com/featured.jpg', title: 'Accreditation update', maxImages: 8, cloudinary })

    expect(result.uploads).toBe(3)
    expect(result.failures).toBe(0)
    expect(result.content).not.toContain('news.example.com')
    expect(result.content).toContain('res.cloudinary.com')
    expect(result.content).toContain('/upload/f_auto,q_auto/')
    expect(result.featuredImage).toContain('res.cloudinary.com')
    expect(findHotlinkedImages(result.content, 'res.cloudinary.com')).toEqual([])
  })

  it('removes a failed image and its italic caption instead of hotlinking it', async () => {
    const content = [
      'The commission approved the programme.',
      '![Broken photo](https://news.example.com/broken.jpg)',
      '*A caption that must go with the image.*',
      '![Working photo](https://news.example.com/working.jpg)',
    ].join('\n\n')

    const result = await processArticleImages({ content, imageUrl: null, title: 'Accreditation update', maxImages: 8, cloudinary })

    expect(result.failures).toBe(1)
    expect(result.content).not.toContain('broken.jpg')
    expect(result.content).not.toContain('A caption that must go with the image')
    expect(result.content).toContain('res.cloudinary.com')
    expect(findHotlinkedImages(result.content, 'res.cloudinary.com')).toEqual([])
    expect(result.featuredImage).toContain('res.cloudinary.com')
  })
})
