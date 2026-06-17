import type { CollectionBeforeChangeHook } from 'payload'

export const approveFirstUser: CollectionBeforeChangeHook = async ({ data, operation, req }) => {
  if (operation !== 'create') {
    return data
  }

  if (typeof data.approved === 'boolean') {
    return data
  }

  const firstUser = await req.payload.db.findOne({
    collection: 'users',
    req,
    where: {},
  })

  if (!firstUser) {
    return {
      ...data,
      approved: true,
    }
  }

  return data
}