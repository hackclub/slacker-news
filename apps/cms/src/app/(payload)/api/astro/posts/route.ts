import config from '@payload-config'
import { getPayload } from 'payload'
import { NextResponse } from 'next/server'
import { lexicalToHtml } from '@/utilities/lexicalToHtml'

const MEDIA_BASE_URL = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000'

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
    authors: Array.isArray(doc.populatedAuthors)
      ? doc.populatedAuthors.map((a: unknown) =>
          typeof a === 'object' && a && 'name' in a
            ? (a as { name: string }).name
            : ''
        ).filter(Boolean)
      : [],
    loginRequired: doc.loginRequired ?? false,
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
