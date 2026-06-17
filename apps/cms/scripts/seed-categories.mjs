import { getPayload } from 'payload'
import config from '@payload-config'

async function main() {
  const payload = await getPayload({ config })

  const categories = ['News', 'Opinion', 'Essays']

  for (const title of categories) {
    const existing = await payload.find({
      collection: 'categories',
      where: { title: { equals: title } },
    })

    if (existing.docs.length === 0) {
      await payload.create({
        collection: 'categories',
        data: { title, slug: title.toLowerCase() },
      })
      console.log(`Created category: ${title}`)
    } else {
      console.log(`Category already exists: ${title}`)
    }
  }

  console.log('Done')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
