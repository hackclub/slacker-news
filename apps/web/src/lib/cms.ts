const CMS_URL = () => process.env.CMS_URL || 'http://localhost:3000'

export type CmsPost = {
  id: string
  title: string
  slug: string
  publishedAt: string | null
  excerpt?: string
  heroImage: { url: string | null; alt: string } | null
  categories: string[]
  authors: string[]
  loginRequired: boolean
  responseTo: string | null
  followUpTo: string | null
  contentHtml: string
}

export async function fetchPosts(options?: { draft?: boolean }): Promise<CmsPost[]> {
  const params = options?.draft ? '?draft=true' : ''
  const url = `${CMS_URL()}/api/astro/posts${params}`

  const res = await fetch(url)

  if (!res.ok) {
    throw new Error(`Failed to fetch posts from CMS: ${res.status} ${res.statusText}`)
  }

  return res.json()
}

export async function fetchPostBySlug(slug: string): Promise<CmsPost | null> {
  const posts = await fetchPosts()
  return posts.find((p) => p.slug === slug) ?? null
}
