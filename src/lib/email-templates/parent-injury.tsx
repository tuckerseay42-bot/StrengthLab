import * as React from "react";

import { Body, Container, Head, Heading, Html, Preview, Text } from "@react-email/components";

interface ParentInjuryEmailProps {
  siteName: string;
  athleteName: string;
  description: string;
  bodyPart?: string | null;
  severity: string;
}

export const ParentInjuryEmail = ({
  siteName,
  athleteName,
  description,
  bodyPart,
  severity,
}: ParentInjuryEmailProps) => {
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{`${athleteName} was marked injured/excused today`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Heads up about {athleteName}</Heading>
          <Text style={text}>
            {athleteName} was marked injured or excused from training today by their coach.
          </Text>
          <Text style={text}>
            <strong>What happened:</strong> {description}
            {bodyPart ? ` (${bodyPart})` : ""}
            <br />
            <strong>Severity:</strong> {severity}
          </Text>
          <Text style={footer}>
            This is an automatic note from {siteName} — reach out to the coaching staff directly for
            any questions.
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export default ParentInjuryEmail;

const main = { backgroundColor: "#ffffff", fontFamily: "Arial, sans-serif" };
const container = { padding: "20px 25px" };
const h1 = { fontSize: "22px", fontWeight: "bold" as const, color: "#000000", margin: "0 0 20px" };
const text = { fontSize: "14px", color: "#55575d", lineHeight: "1.5", margin: "0 0 25px" };
const footer = { fontSize: "12px", color: "#999999", margin: "30px 0 0" };
