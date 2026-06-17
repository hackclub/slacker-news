type LexicalNode = {
  type?: string
  text?: string
  format?: number
  children?: LexicalNode[]
  tag?: string
  direction?: string
  fields?: Record<string, unknown>
  version?: number
}

type MediaDoc = {
  url?: string
  alt?: string
  filename?: string
  width?: number
  height?: number
}

const textFormatMap: Record<number, string[]> = {
  1: ['strong'],
  2: ['em'],
  4: ['u'],
  8: ['code'],
}

function serializeTextNode(node: LexicalNode): string {
  let text = node.text || ''
  const format = node.format || 0

  const tags: string[] = []
  for (const [bit, tagList] of Object.entries(textFormatMap)) {
    if (format & Number(bit)) {
      tags.push(...tagList)
    }
  }

  for (const tag of tags) {
    text = `<${tag}>${text}</${tag}>`
  }

  return text
}

function serializeChildren(nodes: LexicalNode[] | undefined, mediaBaseUrl: string): string {
  if (!nodes) return ''
  return nodes.map((node) => serializeNode(node, mediaBaseUrl)).join('')
}

function serializeNode(node: LexicalNode, mediaBaseUrl: string): string {
  switch (node.type) {
    case 'root': {
      return serializeChildren(node.children, mediaBaseUrl)
    }
    case 'heading': {
      const tag = node.tag || 'h2'
      return `<${tag}>${serializeChildren(node.children, mediaBaseUrl)}</${tag}>`
    }
    case 'paragraph': {
      return `<p>${serializeChildren(node.children, mediaBaseUrl)}</p>`
    }
    case 'text': {
      return serializeTextNode(node)
    }
    case 'link': {
      const fields = node.fields || {}
      const url = fields.url as string || ''
      const newTab = fields.newTab as boolean
      const target = newTab ? ' target="_blank" rel="noopener noreferrer"' : ''
      return `<a href="${url}"${target}>${serializeChildren(node.children, mediaBaseUrl)}</a>`
    }
    case 'list': {
      const listType = (node.fields?.listType as string) || 'bullet'
      const tag = listType === 'number' ? 'ol' : 'ul'
      return `<${tag}>${serializeChildren(node.children, mediaBaseUrl)}</${tag}>`
    }
    case 'listitem': {
      return `<li>${serializeChildren(node.children, mediaBaseUrl)}</li>`
    }
    case 'quote': {
      return `<blockquote>${serializeChildren(node.children, mediaBaseUrl)}</blockquote>`
    }
    case 'horizontalrule':
    case 'horizontalRule': {
      return '<hr>'
    }
    case 'linebreak': {
      return '<br>'
    }
    case 'upload': {
      const fields = node.fields || {}
      const media = fields.value as MediaDoc | undefined
      const src = media?.url ? `${mediaBaseUrl}${media.url}` : ''
      const alt = media?.alt || ''
      return src ? `<img src="${src}" alt="${alt}" loading="lazy">` : ''
    }
    case 'block': {
      const blockFields = node.fields || {}
      const blockType = blockFields.blockType as string
      switch (blockType) {
        case 'banner': {
          const content = blockFields.content as LexicalNode | undefined
          const style = blockFields.style as string || 'info'
          return `<div class="banner banner--${style}">${content ? serializeNode(content, mediaBaseUrl) : ''}</div>`
        }
        case 'code': {
          const code = blockFields.code as string || ''
          const language = blockFields.language as string || 'text'
          return `<pre><code class="language-${language}">${escapeHtml(code)}</code></pre>`
        }
        case 'mediaBlock': {
          const media = blockFields.media as MediaDoc | undefined
          const position = blockFields.position as string || 'default'
          const src = media?.url ? `${mediaBaseUrl}${media.url}` : ''
          const alt = media?.alt || ''
          return src ? `<figure class="media-block media-block--${position}"><img src="${src}" alt="${alt}" loading="lazy"></figure>` : ''
        }
        default:
          return ''
      }
    }
    default: {
      if (node.children) {
        return serializeChildren(node.children, mediaBaseUrl)
      }
      return node.text || ''
    }
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export function lexicalToHtml(content: unknown, mediaBaseUrl: string): string {
  if (!content || typeof content !== 'object') return ''
  const root = (content as { root?: LexicalNode }).root
  if (!root) return ''
  return serializeNode(root, mediaBaseUrl)
}
