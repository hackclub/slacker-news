import { PayloadRequest, CollectionSlug } from 'payload'

const collectionPrefixMap: Partial<Record<CollectionSlug, string>> = {
  posts: '/posts',
  pages: '',
}

type Props = {
  collection: keyof typeof collectionPrefixMap
  slug: string
  req: PayloadRequest
}

export const generatePreviewPath = ({ collection, slug }: Props) => {
  if (slug === undefined || slug === null) {
    return null
  }

  const astroUrl = process.env.ASTRO_URL || 'http://web:80'
  const encodedParams = new URLSearchParams({
    path: `${collectionPrefixMap[collection]}/${slug}`,
    secret: process.env.PREVIEW_SECRET || '',
  })

  return `${astroUrl}/preview?${encodedParams.toString()}`
}
