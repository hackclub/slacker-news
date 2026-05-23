import type { CollectionConfig } from 'payload'

import { authenticated } from '../../access/authenticated'
import { approveFirstUser } from './hooks/approveFirstUser'

export const Users: CollectionConfig = {
  slug: 'users',
  access: {
    admin: ({ req: { user } }) => Boolean(user?.approved),
    create: authenticated,
    delete: authenticated,
    read: authenticated,
    update: authenticated,
  },
  admin: {
    defaultColumns: ['name', 'email', 'approved'],
    useAsTitle: 'name',
  },
  auth: true,
  fields: [
    {
      name: 'name',
      type: 'text',
    },
    {
      name: 'approved',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'hackclubSubject',
      type: 'text',
      unique: true,
      admin: {
        hidden: true,
      },
    },
    {
      name: 'hackclubSlackId',
      type: 'text',
      admin: {
        hidden: true,
      },
    },
    {
      name: 'hackclubVerificationStatus',
      type: 'text',
      admin: {
        hidden: true,
      },
    },
  ],
  hooks: {
    beforeChange: [approveFirstUser],
  },
  timestamps: true,
}
