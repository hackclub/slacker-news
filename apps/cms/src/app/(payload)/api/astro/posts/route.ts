import config from '@payload-config'
import { getPayload } from 'payload'
import { NextResponse } from 'next/server'
import { lexicalToHtml } from '@/utilities/lexicalToHtml'

const MEDIA_BASE_URL = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000'

const normalizePostSlug = (value: unknown) => {
  if (!value) return null

  if (typeof value === 'string') {
    return value.replace(/^(news|opinion|essays)\//, '') || null
  }

  if (typeof value === 'object' && value && 'slug' in value) {
    const slug = (value as { slug?: string | null }).slug
    return slug ? slug.replace(/^(news|opinion|essays)\//, '') || null : null
  }

  return null
}

export async function GET() {
  const payload = await getPayload({ config })

  const result = await payload.find({
    collection: 'posts',
    draft: false,
    depth: 2,
    limit: 1000,
    pagination: false,
    sort: '-publishedAt',
    where: {
      _status: { equals: 'published' },
    },
  })

  const posts = result.docs.map((doc) => ({
    id: doc.id,
    title: doc.title,
    slug: doc.slug,
    publishedAt: doc.publishedAt,
    excerpt: (doc.meta as Record<string, unknown>)?.description as string | undefined,
    heroImage: doc.heroImage
      ? {
          url: typeof doc.heroImage === 'object' && 'url' in doc.heroImage
            ? `${MEDIA_BASE_URL}${(doc.heroImage as { url: string }).url}`
            : null,
          alt: typeof doc.heroImage === 'object' && 'alt' in doc.heroImage
            ? (doc.heroImage as { alt: string }).alt
            : '',
        }
      : null,
    categories: Array.isArray(doc.categories)
      ? doc.categories.map((c: unknown) =>
          typeof c === 'object' && c && 'title' in c
            ? (c as { title: string }).title
            : ''
        ).filter(Boolean)
      : [],
    authors: Array.isArray(doc.authors)
      ? (doc.authors as { name: string }[]).map((a) => a.name).filter(Boolean)
      : [],
    loginRequired: doc.loginRequired ?? false,
    responseTo: normalizePostSlug(doc.responseTo),
    followUpTo: normalizePostSlug(doc.followUpTo),
    contentHtml: lexicalToHtml(doc.content, MEDIA_BASE_URL),
  }))

  const response = NextResponse.json(posts, { status: 200 })
  response.headers.set('Access-Control-Allow-Origin', '*')
  response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type')
  return response
}

export async function OPTIONS() {
  const response = new NextResponse(null, { status: 204 })
  response.headers.set('Access-Control-Allow-Origin', '*')
  response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type')
  return response
}
