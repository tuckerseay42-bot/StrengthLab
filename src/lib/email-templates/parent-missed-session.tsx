import * as React from "react";

import { Body, Container, Head, Heading, Html, Preview, Text } from "@react-email/components";

interface ParentMissedSessionEmailProps {
  siteName: string;
  athleteName: string;
  date: string;
  reason: string;
}

export const ParentMissedSessionEmail = ({
  siteName,
  athleteName,
  date,
  reason,
}: ParentMissedSessionEmailProps) => {
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{`${athleteName} missed today's training session`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Missed session for {athleteName}</Heading>
          <Text style={text}>
            {athleteName} didn't complete today's assigned training session on {date}.
          </Text>
          <Text style={text}>{reason}</Text>
          <Text style={footer}>
            This is an automatic note from {siteName} — reach out to the coaching staff directly for
            any questions.
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export default ParentMissedSessionEmail;

const main = { backgroundColor: "#ffffff", fontFamily: "Arial, sans-serif" };
const container = { padding: "20px 25px" };
const h1 = { fontSize: "22px", fontWeight: "bold" as const, color: "#000000", margin: "0 0 20px" };
const text = { fontSize: "14px", color: "#55575d", lineHeight: "1.5", margin: "0 0 25px" };
const footer = { fontSize: "12px", color: "#999999", margin: "30px 0 0" };
