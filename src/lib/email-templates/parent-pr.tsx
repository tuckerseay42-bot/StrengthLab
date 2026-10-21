import * as React from "react";

import { Body, Container, Head, Heading, Html, Preview, Text } from "@react-email/components";

interface ParentPrEmailProps {
  siteName: string;
  athleteName: string;
  exerciseName: string;
  load: number;
  reps: number;
}

export const ParentPrEmail = ({
  siteName,
  athleteName,
  exerciseName,
  load,
  reps,
}: ParentPrEmailProps) => {
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{`${athleteName} just set a new PR in ${exerciseName}`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>New PR for {athleteName}! 🎉</Heading>
          <Text style={text}>{athleteName} just hit a new personal record in training today:</Text>
          <Text style={pr}>
            {exerciseName} — {load} lb × {reps}
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

export default ParentPrEmail;

const main = { backgroundColor: "#ffffff", fontFamily: "Arial, sans-serif" };
const container = { padding: "20px 25px" };
const h1 = { fontSize: "22px", fontWeight: "bold" as const, color: "#000000", margin: "0 0 20px" };
const text = { fontSize: "14px", color: "#55575d", lineHeight: "1.5", margin: "0 0 25px" };
const pr = {
  fontSize: "18px",
  fontWeight: "bold" as const,
  color: "#000000",
  margin: "0 0 25px",
};
const footer = { fontSize: "12px", color: "#999999", margin: "30px 0 0" };
