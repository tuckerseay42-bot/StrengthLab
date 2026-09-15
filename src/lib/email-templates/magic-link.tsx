import * as React from 'react'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from '@react-email/components'

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
}

function isPinSetup(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.pathname === '/athlete-pin-setup' || parsed.searchParams.get('setupPin') === '1'
  } catch {
    return false
  }
}

export const MagicLinkEmail = ({
  siteName,
  confirmationUrl,
}: MagicLinkEmailProps) => {
  const pinSetup = isPinSetup(confirmationUrl)

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        {pinSetup
          ? `Set up your PIN for ${siteName}`
          : `Your login link for ${siteName}`}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>
            {pinSetup ? 'Set up your PIN' : 'Your login link'}
          </Heading>
          <Text style={text}>
            {pinSetup
              ? `Your coach wants you to create a 6-digit PIN so you can sign in fast at ${siteName}. Click the button below, then enter your email and choose your new PIN.`
              : `Click the button below to log in to ${siteName}. This link will expire shortly.`}
          </Text>
          <Button
            style={pinSetup ? pinButton : button}
            href={confirmationUrl}
          >
            {pinSetup ? 'Set my PIN' : 'Log In'}
          </Button>
          {pinSetup && (
            <Text style={text}>
              Keep your PIN private — it replaces your password for quick kiosk
              and mobile sign-in.
            </Text>
          )}
          <Text style={footer}>
            If you didn't request this link, you can safely ignore this email.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export default MagicLinkEmail

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '20px 25px' }
const h1 = {
  fontSize: '22px',
  fontWeight: 'bold' as const,
  color: '#000000',
  margin: '0 0 20px',
}
const text = {
  fontSize: '14px',
  color: '#55575d',
  lineHeight: '1.5',
  margin: '0 0 25px',
}
const button = {
  backgroundColor: '#000000',
  color: '#ffffff',
  fontSize: '14px',
  borderRadius: '8px',
  padding: '12px 20px',
  textDecoration: 'none',
}
const pinButton = {
  backgroundColor: '#3b82f6',
  color: '#ffffff',
  fontSize: '14px',
  borderRadius: '8px',
  padding: '12px 20px',
  textDecoration: 'none',
}
const footer = { fontSize: '12px', color: '#999999', margin: '30px 0 0' }
