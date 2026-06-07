import { createHmac, randomUUID } from 'crypto'

import { createLocalReq, getFieldsToSign, getPayload, jwtSign } from 'payload'
import { createRemoteJWKSet, jwtVerify } from 'jose'

import configPromise from '@payload-config'
import { getServerSideURL } from './getURL'

const issuerUrl = new URL('https://auth.hackclub.com')
const discoveryUrl = new URL('/.well-known/openid-configuration', issuerUrl)

type HackClubDiscoveryDocument = {
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
  issuer: string
  userinfo_endpoint?: string
}

export type HackClubClaims = {
  sub: string
  aud: string | string[]
  email?: string
  email_verified?: boolean
  name?: string
  given_name?: string
  family_name?: string
  nickname?: string
  slack_id?: string
  verification_status?: string
  ysws_eligible?: boolean
  nonce?: string
}

export type HackClubAuthProfile = {
  email: string
  name: string
  sub: string
  slackId?: string
  verificationStatus?: string
}

const stateCookieName = 'hackclub-oidc-state'
const nonceCookieName = 'hackclub-oidc-nonce'
const hackClubAdminEmailAllowlist = new Set(['hc@matmanna.dev', 'eps@hackclub.com'])

const isHackClubAdmin = (email: string) => hackClubAdminEmailAllowlist.has(email.toLowerCase())

const requireEnv = (name: 'HACKCLUB_CLIENT_ID' | 'HACKCLUB_CLIENT_SECRET') => {
  const value = process.env[name]

  if (!value) {
    throw new Error(`${name} is required to use Hack Club OIDC`)
  }

  return value
}

const getDiscoveryDocument = async (): Promise<HackClubDiscoveryDocument> => {
  const response = await fetch(discoveryUrl)

  if (!response.ok) {
    throw new Error(`Failed to load Hack Club OIDC discovery document: ${response.status}`)
  }

  return response.json() as Promise<HackClubDiscoveryDocument>
}

export const getHackClubRedirectUri = () =>
  process.env.HACKCLUB_REDIRECT_URI || `${getServerSideURL()}/admin/auth/hackclub/callback`

export const getHackClubAuthorizeUrl = async (state: string, nonce: string) => {
  const discovery = await getDiscoveryDocument()
  const authorizeUrl = new URL(discovery.authorization_endpoint)

  authorizeUrl.search = new URLSearchParams({
    client_id: requireEnv('HACKCLUB_CLIENT_ID'),
    nonce,
    redirect_uri: getHackClubRedirectUri(),
    response_type: 'code',
    scope: 'openid profile email verification_status slack_id',
    state,
  }).toString()

  return authorizeUrl.toString()
}

export const createHackClubSessionCookies = () => ({
  nonce: randomUUID(),
  state: randomUUID(),
})

export const getHackClubStateCookieName = () => stateCookieName
export const getHackClubNonceCookieName = () => nonceCookieName

export const getHackClubTokenExchange = async (code: string) => {
  const discovery = await getDiscoveryDocument()

  const response = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: requireEnv('HACKCLUB_CLIENT_ID'),
      client_secret: requireEnv('HACKCLUB_CLIENT_SECRET'),
      code,
      grant_type: 'authorization_code',
      redirect_uri: getHackClubRedirectUri(),
    }),
  })

  if (!response.ok) {
    throw new Error(`Hack Club token exchange failed: ${response.status}`)
  }

  return response.json() as Promise<{
    access_token: string
    id_token: string
    token_type: string
    expires_in?: number
  }>
}

export const verifyHackClubIdToken = async (idToken: string, nonce: string) => {
  const discovery = await getDiscoveryDocument()
  const jwks = createRemoteJWKSet(new URL(discovery.jwks_uri))
  const { payload } = await jwtVerify<HackClubClaims>(idToken, jwks, {
    audience: requireEnv('HACKCLUB_CLIENT_ID'),
    issuer: discovery.issuer,
  })

  if (payload.nonce !== nonce) {
    throw new Error('ID token nonce mismatch')
  }

  return payload
}

export const buildHackClubProfile = (claims: HackClubClaims): HackClubAuthProfile => {
  const email = claims.email?.trim()

  if (!email) {
    throw new Error('Hack Club OIDC did not return an email claim')
  }

  const name =
    claims.name?.trim() ||
    [claims.given_name, claims.family_name].filter(Boolean).join(' ').trim() ||
    email.split('@')[0] ||
    email

  return {
    email,
    name,
    slackId: claims.slack_id,
    sub: claims.sub,
    verificationStatus: claims.verification_status,
  }
}

export const getHackClubUserPassword = (sub: string) => {
  const payloadSecret = process.env.PAYLOAD_SECRET

  if (!payloadSecret) {
    throw new Error('PAYLOAD_SECRET is required to mint a Hack Club admin session')
  }

  return createHmac('sha256', payloadSecret).update(sub).digest('hex')
}

export const getHackClubSession = async (profile: HackClubAuthProfile) => {
  const config = await configPromise
  const payload = await getPayload({ config, cron: true })
  const req = await createLocalReq({ req: { url: getServerSideURL() } }, payload)
  const collection = payload.collections.users

  const existingBySubject = await payload.find({
    collection: 'users',
    limit: 1,
    overrideAccess: true,
    req,
    where: { hackclubSubject: { equals: profile.sub } } as never,
  })

  const existingByEmail =
    existingBySubject.docs[0] ||
    (await payload.find({
      collection: 'users',
      limit: 1,
      overrideAccess: true,
      req,
      where: { email: { equals: profile.email } } as never,
    })).docs[0]

  let userId = existingByEmail?.id
  let user = existingByEmail

  if (!user) {
    throw new Error('Failed to create or load Hack Club admin user')
  }

  if (userId) {
    user = await payload.update({
      collection: 'users',
      data: {
        approved: isHackClubAdmin(profile.email) || user.approved,
        email: profile.email,
        hackclubSlackId: profile.slackId,
        hackclubSubject: profile.sub,
        hackclubVerificationStatus: profile.verificationStatus,
        name: profile.name,
        password: getHackClubUserPassword(profile.sub),
      },
      id: userId,
      overrideAccess: true,
      req,
    })
  } else {
    user = await payload.create({
      collection: 'users',
      data: {
        approved: isHackClubAdmin(profile.email),
        email: profile.email,
        hackclubSlackId: profile.slackId,
        hackclubSubject: profile.sub,
        hackclubVerificationStatus: profile.verificationStatus,
        name: profile.name,
        password: getHackClubUserPassword(profile.sub),
      },
      overrideAccess: true,
      req,
    })
  }

  if (collection.config.auth.useSessions) {
    const sid = randomUUID()
    const now = new Date()
    const tokenExpInMs = collection.config.auth.tokenExpiration * 1000
    const expiresAt = new Date(now.getTime() + tokenExpInMs)
    const session = {
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      id: sid,
    }

    if (!user.sessions?.length) {
      user.sessions = [session]
    } else {
      user.sessions = user.sessions.filter(({ expiresAt: existingExpiresAt }) => {
        const expiry = new Date(existingExpiresAt)
        return expiry > now
      })
      user.sessions.push(session)
    }

    user.updatedAt = null as unknown as string

    await payload.db.updateOne({
      collection: collection.config.slug as 'users',
      data: user as unknown as Record<string, unknown>,
      id: user.id,
      req,
      returning: false,
    })

    user.collection = collection.config.slug as 'users'
    ;(user as unknown as Record<string, unknown>)._strategy = 'local-jwt'

    const fieldsToSign = getFieldsToSign({
      collectionConfig: collection.config,
      email: profile.email,
      sid,
      user: user as any,
    })

    const { token } = await jwtSign({
      fieldsToSign,
      secret: payload.secret,
      tokenExpiration: collection.config.auth.tokenExpiration,
    })

    return {
      authConfig: collection.config.auth,
      cookiePrefix: payload.config.cookiePrefix,
      token,
    }
  }

  const fieldsToSign = getFieldsToSign({
    collectionConfig: collection.config,
    email: profile.email,
    user: user as any,
  })

  const { token } = await jwtSign({
    fieldsToSign,
    secret: payload.secret,
    tokenExpiration: collection.config.auth.tokenExpiration,
  })

  return {
    authConfig: collection.config.auth,
    cookiePrefix: payload.config.cookiePrefix,
    token,
  }
}
