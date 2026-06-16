import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const SEED_SECRET = process.env.SEED_SECRET
const CMS_URL = process.env.CMS_URL || 'http://localhost:3000'
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
      children.push({ type: 'text', text: escapeLexicalText(match[5]), format: 0, code: true })
    } else if (match[1].startsWith('![')) {
      children.push({ type: 'text', text: `[Image: ${match[6]}](${match[7]})` })
    } else if (match[1].startsWith('[')) {
      children.push({ type: 'text', text: escapeLexicalText(match[8]), format: 0, link: match[9] })
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
          children: [],
          format: '',
          indent: 0,
          version: 1,
        }
        rootChildren.push(inList)
      }
      ;(inList.children as Array<Record<string, unknown>>).push({
        type: 'listitem',
        children: parseInlineFormatting(ulMatch[1]),
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
          children: [],
          format: '',
          indent: 0,
          version: 1,
        }
        rootChildren.push(inOrderedList)
      }
      ;(inOrderedList.children as Array<Record<string, unknown>>).push({
        type: 'listitem',
        children: parseInlineFormatting(olMatch[1]),
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

async function api(path: string, options?: RequestInit) {
  const url = `${CMS_URL}/api${path}`
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${JSON.stringify(data)}`)
  return data
}

export async function POST(request: Request) {
  if (SEED_SECRET) {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${SEED_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const results: string[] = []

    for (const title of CATEGORIES) {
      const existing = await api(`/categories?where[slug][equals]=${title}&limit=1&depth=0`)
      if (existing.totalDocs === 0) {
        try {
          await api('/categories', { method: 'POST', body: JSON.stringify({ title }) })
          results.push(`Created category: ${title}`)
        } catch {
          const retry = await api(`/categories?where[slug][equals]=${title}&limit=1&depth=0`)
          if (retry.totalDocs === 0) results.push(`Failed to create category: ${title}`)
        }
      }
    }

    if (results.length === 0) {
      results.push('Categories already exist')
    }

    const postCount = await api('/posts?limit=0&depth=0')
    if (postCount.totalDocs > 0) {
      results.push(`Posts already exist (${postCount.totalDocs}), skipping MDX import`)
      return NextResponse.json({ results })
    }

    if (!fs.existsSync(MDX_POSTS_DIR)) {
      results.push(`MDX posts directory not found: ${MDX_POSTS_DIR}`)
      return NextResponse.json({ results })
    }

    const categoryIdMap: Record<string, string> = {}
    for (const cat of CATEGORIES) {
      const found = await api(`/categories?where[slug][equals]=${cat}&limit=1&depth=0`)
      if (found.docs?.[0]) categoryIdMap[cat] = String(found.docs[0].id)
    }

    let createdCount = 0
    for (const category of CATEGORIES) {
      const dir = path.join(MDX_POSTS_DIR, category === 'changelogs' ? 'changelogs' : category)
      if (!fs.existsSync(dir)) continue

      const files = fs.readdirSync(dir).filter(f => f.endsWith('.mdx'))
      for (const file of files) {
        const raw = fs.readFileSync(path.join(dir, file), 'utf-8')
        const { data, content: rawContent } = parseFrontmatter(raw)
        const cleanedContent = astroComponentToText(rawContent)
        const lexical = markdownToLexical(cleanedContent)

        const slug = file.replace(/\.mdx$/, '')
        const postTitle = data.title || slug
        const authorName = data.author || ''

        let responseToId: string | null = null
        let followUpToId: string | null = null

        const responseToSlug = data.responseTo || null
        if (responseToSlug) {
          const ref = await api(`/posts?where[slug][equals]=${responseToSlug}&limit=1&depth=0`)
          if (ref.docs?.[0]) responseToId = String(ref.docs[0].id)
        }

        const followUpToSlug = data.followUpTo || null
        if (followUpToSlug) {
          const ref = await api(`/posts?where[slug][equals]=${followUpToSlug}&limit=1&depth=0`)
          if (ref.docs?.[0]) followUpToId = String(ref.docs[0].id)
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

        const result = await api('/posts', { method: 'POST', body: JSON.stringify(postData) })

        if (result.id) {
          await api(`/posts/${result.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ _status: 'published' }),
          })
          createdCount++
        }
      }
    }

    results.push(`Created ${createdCount} posts from MDX files`)
    return NextResponse.json({ results })
  } catch (error) {
    console.error('Seed error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
