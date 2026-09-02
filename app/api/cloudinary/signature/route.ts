import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/editorial-auth'

async function createSignature(folder = 'futo-central/news') {
  await requireAdmin()
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME
  const apiKey = process.env.CLOUDINARY_API_KEY
  const secret = process.env.CLOUDINARY_API_SECRET
  if (!cloudName || !apiKey || !secret) return NextResponse.json({ error: 'Cloudinary is not configured.' }, { status: 503 })
  const timestamp = Math.floor(Date.now() / 1000)
  const safeFolder = folder.trim() || 'futo-central/news'
  const signature = createHash('sha1').update(`folder=${safeFolder}&timestamp=${timestamp}${secret}`).digest('hex')
  return NextResponse.json({ cloudName, apiKey, timestamp, folder: safeFolder, signature })
}

export async function GET() {
  return createSignature()
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { folder?: string }
  return createSignature(body.folder)
}
