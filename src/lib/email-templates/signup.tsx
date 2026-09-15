import * as React from 'react'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Text,
} from '@react-email/components'

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
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

export const SignupEmail = ({
  siteName,
  siteUrl,
  recipient,
  confirmationUrl,
}: SignupEmailProps) => {
  const pinSetup = isPinSetup(confirmationUrl)

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        {pinSetup
          ? `Confirm your email and set your PIN for ${siteName}`
          : `Confirm your email for ${siteName}`}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>
            {pinSetup ? 'Confirm your email & set PIN' : 'Confirm your email'}
          </Heading>
          <Text style={text}>
            Thanks for signing up for{' '}
            <Link href={siteUrl} style={link}>
              <strong>{siteName}</strong>
            </Link>
            !
          </Text>
          <Text style={text}>
            {pinSetup
              ? `Please confirm ${recipient}, then enter your email and create your 6-digit PIN. This PIN lets you sign in fast at the weight room kiosk or on your phone.`
              : `Please confirm your email address (${recipient}) by clicking the button below:`}
          </Text>
          <Button style={pinSetup ? pinButton : button} href={confirmationUrl}>
            {pinSetup ? 'Set my PIN' : 'Verify Email'}
          </Button>
          {pinSetup && (
            <Text style={text}>
              Keep your PIN private — it replaces your password for quick sign-in.
            </Text>
          )}
          <Text style={footer}>
            If you didn't create an account, you can safely ignore this email.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export default SignupEmail

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
const link = { color: 'inherit', textDecoration: 'underline' }
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
