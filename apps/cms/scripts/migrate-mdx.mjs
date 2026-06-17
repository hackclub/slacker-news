import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CMS_URL = process.env.CMS_URL || 'http://localhost:3000';
const MDX_DIR = path.resolve(__dirname, '../../../apps/web/src/content/posts');

console.log('CMS_URL:', CMS_URL);

// Simple frontmatter parser (YAML-like)
function parseFrontmatter(text) {
  const match = text.match(/^---\s*\n([\s\S]*?)\n(?:---|\.\.\.)\s*\n([\s\S]*)$/);
  if (!match) return { data: {}, content: text };
  const frontmatter = {};
  let key = null;
  for (const line of match[1].split('\n')) {
    const kvMatch = line.match(/^(\w+):\s*(.*)/);
    if (kvMatch) {
      key = kvMatch[1];
      let value = kvMatch[2].replace(/^['"]|['"]$/g, '').trim();
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      frontmatter[key] = value;
    } else if (key && line.startsWith('  ')) {
      frontmatter[key] += '\n' + line.trim();
    }
  }
  return { data: frontmatter, content: match[2] };
}

function astroComponentToText(text) {
  return text
    .replace(/<SlackChannel\s+id="([^"]+)"\s*\/>/g, '#$1')
    .replace(/<SlackMention\s+name="([^"]+)"\s+id="[^"]*"\s*\/>/g, '@$1')
    .replace(/<[^>]+>/g, '')
    .replace(/^\s*import\s+.*/gm, '');
}

function escapeLexicalText(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseInlineFormatting(text) {
  const children = [];
  const parts = [];
  let remaining = text;

  const inlineRe = /(\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]*)\]\(([^)]+)\))/;
  
  while (remaining.length > 0) {
    const match = remaining.match(inlineRe);
    if (!match) {
      if (remaining.trim()) {
        children.push({ type: 'text', text: escapeLexicalText(remaining) });
      }
      break;
    }

    if (match.index > 0) {
      const before = remaining.slice(0, match.index);
      if (before.trim()) {
        children.push({ type: 'text', text: escapeLexicalText(before) });
      }
    }

    if (match[1].startsWith('***')) {
      children.push({ type: 'text', text: escapeLexicalText(match[2]), format: 3 });
    } else if (match[1].startsWith('**')) {
      children.push({ type: 'text', text: escapeLexicalText(match[3]), format: 1 });
    } else if (match[1].startsWith('*') && !match[1].startsWith('**')) {
      children.push({ type: 'text', text: escapeLexicalText(match[4]), format: 2 });
    } else if (match[1].startsWith('`')) {
      children.push({ type: 'text', text: escapeLexicalText(match[5]), format: 0, code: true });
    } else if (match[1].startsWith('![')) {
      children.push({ type: 'text', text: `[Image: ${match[6]}](${match[7]})` });
    } else if (match[1].startsWith('[')) {
      children.push({ type: 'text', text: escapeLexicalText(match[8]), format: 0, link: match[9] });
    }

    remaining = remaining.slice(match.index + match[0].length);
  }

  return children;
}

function markdownToLexical(md) {
  const rootChildren = [];
  const lines = md.split('\n');

  let currentQuote = null;
  let inList = null;
  let inOrderedList = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim() === '---') continue;

    if (line.trim() === '') {
      if (currentQuote) { currentQuote = null; }
      inList = null;
      inOrderedList = null;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const tag = `h${headingMatch[1].length}`;
      rootChildren.push({
        type: 'heading',
        tag,
        children: parseInlineFormatting(headingMatch[2]),
        format: '',
        indent: 0,
        version: 1,
      });
      continue;
    }

    const quoteMatch = line.match(/^>\s?(.*)/);
    if (quoteMatch) {
      const text = quoteMatch[1];
      if (!currentQuote) {
        currentQuote = {
          type: 'quote',
          children: [],
          format: '',
          indent: 0,
          version: 1,
        };
        rootChildren.push(currentQuote);
      }
      if (text.trim()) {
        currentQuote.children.push({
          type: 'paragraph',
          children: parseInlineFormatting(text),
          format: '',
          indent: 0,
          version: 1,
        });
      }
      continue;
    }

    const ulMatch = line.match(/^[-*]\s+(.+)/);
    if (ulMatch) {
      inOrderedList = null;
      if (!inList) {
        inList = {
          type: 'list',
          listType: 'bullet',
          children: [],
          format: '',
          indent: 0,
          version: 1,
        };
        rootChildren.push(inList);
      }
      inList.children.push({
        type: 'listitem',
        children: parseInlineFormatting(ulMatch[1]),
        value: 1,
        format: '',
        indent: 0,
        version: 1,
      });
      continue;
    }

    const olMatch = line.match(/^\d+\.\s+(.+)/);
    if (olMatch) {
      inList = null;
      if (!inOrderedList) {
        inOrderedList = {
          type: 'list',
          listType: 'number',
          children: [],
          format: '',
          indent: 0,
          version: 1,
        };
        rootChildren.push(inOrderedList);
      }
      inOrderedList.children.push({
        type: 'listitem',
        children: parseInlineFormatting(olMatch[1]),
        value: 1,
        format: '',
        indent: 0,
        version: 1,
      });
      continue;
    }

    // Image on its own line
    const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imgMatch) {
      rootChildren.push({
        type: 'paragraph',
        children: [{ type: 'text', text: `[Image: ${imgMatch[1]}](${imgMatch[2]})` }],
        format: '',
        indent: 0,
        version: 1,
      });
      continue;
    }

    // Horizontal rule
    if (line.match(/^---\s*$/)) {
      rootChildren.push({
        type: 'horizontalrule',
        format: '',
        indent: 0,
        version: 1,
      });
      continue;
    }

    // Regular paragraph
    const textChildren = parseInlineFormatting(line);
    if (textChildren.length > 0) {
      inList = null;
      inOrderedList = null;
      rootChildren.push({
        type: 'paragraph',
        children: textChildren,
        format: '',
        indent: 0,
        version: 1,
      });
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
  };
}

async function createPost(postData) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const { _status, ...createData } = postData;
    const createResponse = await fetch(`${CMS_URL}/api/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createData),
      signal: controller.signal,
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error(`Create post failed (${createResponse.status}): ${errorText}`);
      return null;
    }

    const result = await createResponse.json();
    const postId = result.doc.id;

    if (_status === 'published') {
      const publishResponse = await fetch(`${CMS_URL}/api/posts/${postId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _status: 'published' }),
        signal: controller.signal,
      });

      if (!publishResponse.ok) {
        console.error(`Publish failed for ${postData.slug}: ${await publishResponse.text()}`);
      } else {
        console.log(`  Published: id=${postId}`);
      }
    }

    return result;
  } catch (err) {
    console.error(`Fetch error: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const categories = ['news', 'opinion', 'essays', 'changelogs'];
  const categoryIdMap = {};

  // Get category IDs
  try {
    const catResponse = await fetch(`${CMS_URL}/api/categories`, { signal: AbortSignal.timeout(10000) });
    if (catResponse.ok) {
      const catData = await catResponse.json();
      for (const cat of catData.docs) {
        categoryIdMap[cat.title.toLowerCase()] = cat.id;
      }
    }
  } catch (err) {
    console.error('Failed to fetch categories:', err.message);
  }
  console.log('Category map:', categoryIdMap);

  for (const category of categories) {
    const dir = path.join(MDX_DIR, category === 'changelogs' ? 'changelogs' : category);
    if (!fs.existsSync(dir)) continue;

    const files = fs.readdirSync(dir).filter(f => f.endsWith('.mdx'));
    for (const file of files) {
      const filePath = path.join(dir, file);
      const raw = fs.readFileSync(filePath, 'utf-8');
      const { data, content: rawContent } = parseFrontmatter(raw);
      const cleanedContent = astroComponentToText(rawContent);
      const lexical = markdownToLexical(cleanedContent);

      const slug = file.replace(/\.mdx$/, '');
      const postTitle = data.title || slug;
      const authorName = data.author || '';

      const postData = {
        title: postTitle,
        slug,
        content: lexical,
        authors: authorName ? [{ name: authorName }] : [],
        publishedAt: data.date ? new Date(data.date).toISOString() : null,
        _status: 'published',
        loginRequired: false,
        responseTo: data.responseTo || null,
        followUpTo: data.followUpTo || null,
      };

      if (categoryIdMap[category]) {
        postData.categories = [categoryIdMap[category]];
      }

      console.log(`Creating post: "${postTitle}" (${slug})`);
      const result = await createPost(postData);
      if (result) {
        console.log(`  Created: id=${result.doc.id}`);
      }
    }
  }
}

main().catch(console.error);
