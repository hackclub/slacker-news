import { NextResponse } from 'next/server'

import { generatePayloadCookie } from 'payload'

import { buildHackClubProfile, getHackClubNonceCookieName, getHackClubSession, getHackClubStateCookieName, getHackClubTokenExchange, verifyHackClubIdToken } from '@/utilities/hackclubOidc'

const secureCookie = process.env.NEXT_PUBLIC_SERVER_URL?.startsWith('https://') ?? false

const clearHackClubCookies = (response: NextResponse) => {
  response.cookies.set(getHackClubNonceCookieName(), '', {
    expires: new Date(0),
    path: '/',
    secure: secureCookie,
  })
  response.cookies.set(getHackClubStateCookieName(), '', {
    expires: new Date(0),
    path: '/',
    secure: secureCookie,
  })
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const error = url.searchParams.get('error')
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  if (error || !code || !state) {
    const response = NextResponse.redirect(new URL('/admin/login?oidc=failed', request.url))
    clearHackClubCookies(response)
    return response
  }

  const cookieHeader = request.headers.get('cookie') || ''
  const expectedState = cookieHeader.match(new RegExp(`${getHackClubStateCookieName()}=([^;]+)`))?.[1]
  const nonce = cookieHeader.match(new RegExp(`${getHackClubNonceCookieName()}=([^;]+)`))?.[1]

  if (!expectedState || !nonce || expectedState !== state) {
    const response = NextResponse.redirect(new URL('/admin/login?oidc=state_mismatch', request.url))
    clearHackClubCookies(response)
    return response
  }

  try {
    const { id_token } = await getHackClubTokenExchange(code)
    const claims = await verifyHackClubIdToken(id_token, nonce)
    const profile = buildHackClubProfile(claims)
    const { authConfig, cookiePrefix, token } = await getHackClubSession(profile)

    const response = NextResponse.redirect(new URL('/admin', request.url))
    const payloadCookie = generatePayloadCookie({
      collectionAuthConfig: authConfig,
      cookiePrefix,
      returnCookieAsObject: true,
      token,
    })

    if (payloadCookie.value) {
      response.cookies.set(payloadCookie.name, payloadCookie.value, {
        domain: payloadCookie.domain,
        expires: payloadCookie.expires ? new Date(payloadCookie.expires) : undefined,
        httpOnly: true,
        path: payloadCookie.path,
        sameSite: payloadCookie.sameSite ? payloadCookie.sameSite.toLowerCase() as 'lax' | 'strict' | 'none' : 'lax',
        secure: payloadCookie.secure ?? false,
      })
    }

    clearHackClubCookies(response)

    return response
  } catch (error) {
    const response = NextResponse.redirect(new URL('/admin/login?oidc=error', request.url))
    clearHackClubCookies(response)
    return response
  }
}