import { NextResponse } from 'next/server'

import { createHackClubSessionCookies, getHackClubAuthorizeUrl, getHackClubNonceCookieName, getHackClubStateCookieName } from '@/utilities/hackclubOidc'

const secureCookie = process.env.NEXT_PUBLIC_SERVER_URL?.startsWith('https://') ?? false

export async function GET() {
  if (!process.env.HACKCLUB_CLIENT_ID || !process.env.HACKCLUB_CLIENT_SECRET) {
    return NextResponse.redirect(new URL('/admin/login?oidc=config_missing', process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000'))
  }

  const { nonce, state } = createHackClubSessionCookies()
  const response = NextResponse.redirect(await getHackClubAuthorizeUrl(state, nonce))

  response.cookies.set(getHackClubStateCookieName(), state, {
    httpOnly: true,
    maxAge: 600,
    path: '/',
    sameSite: 'lax',
    secure: secureCookie,
  })

  response.cookies.set(getHackClubNonceCookieName(), nonce, {
    httpOnly: true,
    maxAge: 600,
    path: '/',
    sameSite: 'lax',
    secure: secureCookie,
  })

  return response
}