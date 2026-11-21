import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import './globals.css'
import { absoluteUrl, siteName, siteDescription } from '@/lib/seo'
import { AdcashLoader } from '@/components/adcash-loader'
import { getPublishedNotices } from '@/lib/notices-data'
import { NoticeWidget } from '@/components/futo/notice-widget'

export const metadata: Metadata = {
  metadataBase: new URL(absoluteUrl('/')),
  title: { default: `${siteName} — FUTO News, Campus Updates & Stories`, template: `%s | ${siteName}` },
  description: siteDescription,
  alternates: { canonical: '/', types: { 'application/rss+xml': '/rss.xml' } },
  manifest: '/manifest.json',
  openGraph: { siteName, type: 'website', url: '/', title: `${siteName} — FUTO News, Campus Updates & Stories`, description: siteDescription, images: [{ url: '/og-image.png', width: 1200, height: 630, alt: siteName }] },
  twitter: { card: 'summary_large_image', title: `${siteName} — FUTO News, Campus Updates & Stories`, description: siteDescription, images: ['/og-image.png'] },
  generator: 'v0.app',
  icons: {
    icon: 'https://hebbkx1anhila5yf.public.blob.vercel-storage.com/favicon-32x32-vEY30c4JOE2iKePtBlVSFF4A4q9cnk.png',
    apple: 'https://hebbkx1anhila5yf.public.blob.vercel-storage.com/apple-touch-icon-EycjI1VWLDfAqe9dcQIwwzxBfxbbBp.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#073b25',
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const publishedNotices = await getPublishedNotices()
  return (
    <html lang="en" className="bg-background">
      <body className="antialiased">
        {children}
        <NoticeWidget notices={publishedNotices} />
        <AdcashLoader />
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
