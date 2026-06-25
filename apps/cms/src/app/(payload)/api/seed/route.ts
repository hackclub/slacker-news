import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import fs from 'fs'
import path from 'path'

const SEED_SECRET = process.env.SEED_SECRET
const MDX_POSTS_DIR = process.env.MDX_POSTS_DIR || '/app/mdx-posts'

const CATEGORIES = ['news', 'opinion', 'essays', 'changelogs'] as const

function parseFrontmatter(text: string) {
  const match = text.match(/^---\s*\n([\s\S]*?)\n(?:---|\.\.\.)\s*\n([\s\S]*)$/)
  if (!match) return { data: {}, content: text }
  const frontmatter: Record<string, unknown> = {}
  let key: string | null = null
  for (const line of match[1].split('\n')) {
    const kvMatch = line.match(/^(\w+):\s*(.*)/)
    if (kvMatch) {
      key = kvMatch[1]
      let value: string | boolean = kvMatch[2].replace(/^['"]|['"]$/g, '').trim()
      if (value === 'true') value = true
      else if (value === 'false') value = false
      frontmatter[key] = value
    } else if (key && line.startsWith('  ')) {
      frontmatter[key] += '\n' + (line as string).trim()
    }
  }
  return { data: frontmatter as { title?: string; author?: string; date?: string; responseTo?: string; followUpTo?: string }, content: match[2] }
}

function astroComponentToText(text: string) {
  return text
    .replace(/<SlackChannel\s+id="([^"]+)"\s*\/>/g, '#$1')
    .replace(/<SlackMention\s+name="([^"]+)"\s+id="[^"]*"\s*\/>/g, '@$1')
    .replace(/<[^>]+>/g, '')
    .replace(/^\s*import\s+.*/gm, '')
}

function escapeLexicalText(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function parseInlineFormatting(text: string) {
  const children: Array<Record<string, unknown>> = []
  let remaining = text

  const inlineRe = /(\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]*)\]\(([^)]+)\))/

  while (remaining.length > 0) {
    const match = remaining.match(inlineRe)
    if (!match) {
      if (remaining.trim()) {
        children.push({ type: 'text', text: escapeLexicalText(remaining) })
      }
      break
    }

    if (match.index && match.index > 0) {
      const before = remaining.slice(0, match.index)
      if (before.trim()) {
        children.push({ type: 'text', text: escapeLexicalText(before) })
      }
    }

    if (match[1].startsWith('***')) {
      children.push({ type: 'text', text: escapeLexicalText(match[2]), format: 3 })
    } else if (match[1].startsWith('**')) {
      children.push({ type: 'text', text: escapeLexicalText(match[3]), format: 1 })
    } else if (match[1].startsWith('*') && !match[1].startsWith('**')) {
      children.push({ type: 'text', text: escapeLexicalText(match[4]), format: 2 })
    } else if (match[1].startsWith('`')) {
      children.push({ type: 'text', text: escapeLexicalText(match[5]), format: 16 })
    } else if (match[1].startsWith('![')) {
      children.push({ type: 'text', text: `[Image: ${match[6]}](${match[7]})` })
    } else if (match[1].startsWith('[')) {
      children.push({
        type: 'link',
        children: [{ type: 'text', text: escapeLexicalText(match[8]), format: 0 }],
        direction: 'ltr',
        fields: { doc: null, linkType: 'custom', newTab: false, url: match[9] },
        format: '',
        indent: 0,
        version: 2,
      })
    }

    remaining = remaining.slice((match.index || 0) + match[0].length)
  }

  return children
}

function markdownToLexical(md: string) {
  const rootChildren: Array<Record<string, unknown>> = []
  const lines = md.split('\n')

  let currentQuote: Record<string, unknown> | null = null
  let inList: Record<string, unknown> | null = null
  let inOrderedList: Record<string, unknown> | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.trim() === '---') continue

    if (line.trim() === '') {
      currentQuote = null
      inList = null
      inOrderedList = null
      continue
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)/)
    if (headingMatch) {
      rootChildren.push({
        type: 'heading',
        tag: `h${headingMatch[1].length}`,
        children: parseInlineFormatting(headingMatch[2]),
        format: '',
        indent: 0,
        version: 1,
      })
      continue
    }

    const quoteMatch = line.match(/^>\s?(.*)/)
    if (quoteMatch) {
      const text = quoteMatch[1]
      if (!currentQuote) {
        currentQuote = {
          type: 'quote',
          children: [],
          format: '',
          indent: 0,
          version: 1,
        }
        rootChildren.push(currentQuote)
      }
      if (text.trim()) {
        ;(currentQuote.children as Array<Record<string, unknown>>).push({
          type: 'paragraph',
          children: parseInlineFormatting(text),
          format: '',
          indent: 0,
          version: 1,
        })
      }
      continue
    }

    const ulMatch = line.match(/^[-*]\s+(.+)/)
    if (ulMatch) {
      inOrderedList = null
      if (!inList) {
        inList = {
          type: 'list',
          listType: 'bullet',
          tag: 'ul',
          start: 1,
          children: [],
          format: '',
          indent: 0,
          direction: null,
          version: 1,
        }
        rootChildren.push(inList)
      }
      ;(inList.children as Array<Record<string, unknown>>).push({
        type: 'listitem',
        children: [{
          type: 'paragraph',
          children: parseInlineFormatting(ulMatch[1]),
          format: '',
          indent: 0,
          version: 1,
        }],
        value: 1,
        format: '',
        indent: 0,
        version: 1,
      })
      continue
    }

    const olMatch = line.match(/^\d+\.\s+(.+)/)
    if (olMatch) {
      inList = null
      if (!inOrderedList) {
        inOrderedList = {
          type: 'list',
          listType: 'number',
          tag: 'ol',
          start: 1,
          children: [],
          format: '',
          indent: 0,
          direction: null,
          version: 1,
        }
        rootChildren.push(inOrderedList)
      }
      ;(inOrderedList.children as Array<Record<string, unknown>>).push({
        type: 'listitem',
        children: [{
          type: 'paragraph',
          children: parseInlineFormatting(olMatch[1]),
          format: '',
          indent: 0,
          version: 1,
        }],
        value: 1,
        format: '',
        indent: 0,
        version: 1,
      })
      continue
    }

    const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
    if (imgMatch) {
      rootChildren.push({
        type: 'paragraph',
        children: [{ type: 'text', text: `[Image: ${imgMatch[1]}](${imgMatch[2]})` }],
        format: '',
        indent: 0,
        version: 1,
      })
      continue
    }

    if (line.match(/^---\s*$/)) {
      rootChildren.push({
        type: 'horizontalrule',
        format: '',
        indent: 0,
        version: 1,
      })
      continue
    }

    const textChildren = parseInlineFormatting(line)
    if (textChildren.length > 0) {
      inList = null
      inOrderedList = null
      rootChildren.push({
        type: 'paragraph',
        children: textChildren,
        format: '',
        indent: 0,
        version: 1,
      })
    }
  }

  return {
    root: {
      type: 'root',
      format: '',
      indent: 0,
      version: 1,
      children: rootChildren,
      direction: null,
    },
  }
}

export async function POST(request: Request) {
  if (SEED_SECRET) {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${SEED_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  let onUnhandledRejection: ((reason: unknown) => void) | null = null
  try {
    onUnhandledRejection = (reason: unknown) => {
      console.error('Unhandled Rejection in seed route:', reason)
    }
    process.on('unhandledRejection', onUnhandledRejection)

    const payload = await getPayload({ config: configPromise })
    const results: string[] = []

    for (const title of CATEGORIES) {
      const existing = await payload.find({
        collection: 'categories',
        where: { slug: { equals: title } },
        limit: 1,
        depth: 0,
      })
      if (existing.totalDocs === 0) {
        try {
          await payload.create({ collection: 'categories', data: { title }, overrideAccess: true, depth: 0, draft: true })
          results.push(`Created category: ${title}`)
        } catch {
          const retry = await payload.find({
            collection: 'categories',
            where: { slug: { equals: title } },
            limit: 1,
            depth: 0,
          })
          if (retry.totalDocs === 0) results.push(`Failed to create category: ${title}`)
        }
      }
    }

    if (results.length === 0) {
      results.push('Categories already exist')
    }

    if (!fs.existsSync(MDX_POSTS_DIR)) {
      results.push(`MDX posts directory not found: ${MDX_POSTS_DIR}`)
      return NextResponse.json({ results })
    }

    const categoryIdMap: Record<string, string> = {}
    for (const cat of CATEGORIES) {
      const found = await payload.find({
        collection: 'categories',
        where: { slug: { equals: cat } },
        limit: 1,
        depth: 0,
      })
      if (found.docs[0]) categoryIdMap[cat] = String(found.docs[0].id)
    }

    let createdCount = 0
    let fixedCount = 0
    for (const category of CATEGORIES) {
      const dir = path.join(MDX_POSTS_DIR, category === 'changelogs' ? 'changelogs' : category)
      if (!fs.existsSync(dir)) continue

      const files = fs.readdirSync(dir).filter(f => f.endsWith('.mdx'))
      for (const file of files) {
        const filePath = path.join(dir, file)
        const raw = fs.readFileSync(filePath, 'utf-8')
        const { data, content: rawContent } = parseFrontmatter(raw)
        const cleanedContent = astroComponentToText(rawContent)
        const lexical = markdownToLexical(cleanedContent)

        const slug = file.replace(/\.mdx$/, '').replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-_]/g, '')
        const postTitle = data.title || slug
        const authorName = data.author || ''

        let responseToId: string | null = null
        let followUpToId: string | null = null

        if (data.responseTo) {
          const ref = await payload.find({
            collection: 'posts',
            where: { slug: { equals: data.responseTo } },
            limit: 1,
            depth: 0,
          })
          if (ref.docs[0]) responseToId = String(ref.docs[0].id)
        }
        if (data.followUpTo) {
          const ref = await payload.find({
            collection: 'posts',
            where: { slug: { equals: data.followUpTo } },
            limit: 1,
            depth: 0,
          })
          if (ref.docs[0]) followUpToId = String(ref.docs[0].id)
        }

        const postData: Record<string, unknown> = {
          title: postTitle,
          slug,
          content: lexical,
          authors: authorName ? [{ name: authorName }] : [],
          publishedAt: data.date ? new Date(data.date).toISOString() : null,
          _status: 'published',
          loginRequired: false,
          responseTo: responseToId,
          followUpTo: followUpToId,
        }

        if (categoryIdMap[category]) {
          postData.categories = [categoryIdMap[category]]
        }

        try {
          const result = await payload.create({
            collection: 'posts',
            data: postData,
            overrideAccess: true,
            draft: true,
          })
          if (result.id) {
            await payload.update({
              collection: 'posts',
              id: String(result.id),
              data: { _status: 'published' },
              overrideAccess: true,
            })
            createdCount++
          }
        } catch (err: any) {
          const isSlugError = err?.message?.includes?.('slug') ||
            err?.data?.errors?.some?.((e: any) => e?.field === 'slug')
          if (isSlugError) {
            const found = await payload.find({
              collection: 'posts',
              where: { slug: { equals: slug } },
              limit: 1,
              depth: 0,
              overrideAccess: true,
            })
            if (found.docs[0]) {
              await payload.update({
                collection: 'posts',
                id: String(found.docs[0].id),
                data: { content: lexical as any },
                overrideAccess: true,
              })
              fixedCount++
            } else {
              throw err
            }
          } else {
            throw err
          }
        }
      }
    }

    results.push(`Fixed ${fixedCount} existing posts, created ${createdCount} new posts`)
    if (onUnhandledRejection) process.removeListener('unhandledRejection', onUnhandledRejection)
    return NextResponse.json({ results })
  } catch (error) {
    if (onUnhandledRejection) process.removeListener('unhandledRejection', onUnhandledRejection)
    console.error('Seed error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
