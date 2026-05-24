import React from 'react'

import { Button } from '@/components/ui/button'

const BeforeLogin: React.FC = () => {
  const hasHackClubAuth = Boolean(process.env.HACKCLUB_CLIENT_ID && process.env.HACKCLUB_CLIENT_SECRET)

  return (
    <div className="space-y-4">
      <style>{`.login__form { display: none !important; }`}</style>
      <p className="max-w-md text-sm leading-6 text-muted-foreground">
        <b>Welcome to the Slacker Newsroom!</b>
        {'For now, only site admins can log in to manage the content and management/delivery system settings. '}
      </p>
      {hasHackClubAuth ? (
        <Button asChild className="bg-[#ec3750] text-white shadow-lg shadow-[#ec3750]/25 hover:bg-[#d92e46] hover:text-white">
          <a href="/admin/auth/hackclub/start">Sign in with Hack Club</a>
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">Hack Club sign in is not configured yet.</p>
      )}
    </div>
  )
}

export default BeforeLogin
