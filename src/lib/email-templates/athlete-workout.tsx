import * as React from "react";

import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Row,
  Section,
  Text,
} from "@react-email/components";

export type AthleteWorkoutEmailRow = {
  block: string;
  exercise: string;
  setNumber: number;
  reps: string | number;
  weight: string;
};

interface AthleteWorkoutEmailProps {
  siteName: string;
  athleteName: string;
  teamName: string;
  sessionName: string;
  scheduledDate: string | null;
  coachNotes?: string | null;
  rows: AthleteWorkoutEmailRow[];
  loginUrl: string;
}

export const AthleteWorkoutEmail = ({
  siteName,
  athleteName,
  teamName,
  sessionName,
  scheduledDate,
  coachNotes,
  rows,
  loginUrl,
}: AthleteWorkoutEmailProps) => {
  let lastExercise: string | null = null;
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{`${teamName} — ${sessionName}${scheduledDate ? ` (${scheduledDate})` : ""}`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{sessionName}</Heading>
          <Text style={subtitle}>
            {teamName}
            {scheduledDate ? ` · ${scheduledDate}` : ""}
          </Text>
          <Text style={text}>Hey {athleteName}, here's today's session:</Text>

          {coachNotes && (
            <Section style={notesBox}>
              <Text style={notesText}>{coachNotes}</Text>
            </Section>
          )}

          <Section style={table}>
            {rows.length === 0 ? (
              <Text style={text}>No exercises in this session yet.</Text>
            ) : (
              rows.map((r, i) => {
                const showExercise = r.exercise !== lastExercise;
                lastExercise = r.exercise;
                return (
                  <Row key={i} style={showExercise ? rowWithBorder : rowPlain}>
                    <Column style={exerciseCell}>
                      <Text style={showExercise ? exerciseText : blankText}>
                        {showExercise ? r.exercise : ""}
                      </Text>
                    </Column>
                    <Column style={detailCell}>
                      <Text style={detailText}>
                        {r.setNumber === 0 ? "—" : `Set ${r.setNumber}`} · {r.reps} reps ·{" "}
                        {r.weight}
                      </Text>
                    </Column>
                  </Row>
                );
              })
            )}
          </Section>

          <Hr style={hr} />

          <Button style={button} href={loginUrl}>
            Open &amp; log this session
          </Button>

          <Text style={footer}>
            This is an automatic note from {siteName} — reach out to your coach directly with any
            questions.
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export default AthleteWorkoutEmail;

const main = { backgroundColor: "#ffffff", fontFamily: "Arial, sans-serif" };
const container = { padding: "20px 25px" };
const h1 = { fontSize: "22px", fontWeight: "bold" as const, color: "#000000", margin: "0 0 4px" };
const subtitle = { fontSize: "13px", color: "#55575d", margin: "0 0 20px" };
const text = { fontSize: "14px", color: "#55575d", lineHeight: "1.5", margin: "0 0 16px" };
const notesBox = {
  backgroundColor: "#fef9c3",
  borderRadius: "8px",
  padding: "10px 14px",
  margin: "0 0 16px",
};
const notesText = { fontSize: "13px", color: "#713f12", margin: 0, lineHeight: "1.4" };
const table = { margin: "0 0 8px" };
const rowWithBorder = { borderTop: "1px solid #e5e7eb", paddingTop: "8px" };
const rowPlain = { paddingTop: "2px" };
const exerciseCell = { width: "45%", verticalAlign: "top" as const, paddingBottom: "4px" };
const detailCell = { width: "55%", verticalAlign: "top" as const, paddingBottom: "4px" };
const exerciseText = {
  fontSize: "14px",
  fontWeight: "bold" as const,
  color: "#000000",
  margin: "4px 0",
};
const blankText = { fontSize: "14px", margin: "4px 0" };
const detailText = { fontSize: "13px", color: "#55575d", margin: "4px 0" };
const hr = { borderColor: "#e5e7eb", margin: "16px 0" };
const button = {
  backgroundColor: "#000000",
  color: "#ffffff",
  fontSize: "14px",
  borderRadius: "8px",
  padding: "12px 20px",
  textDecoration: "none",
};
const footer = { fontSize: "12px", color: "#999999", margin: "24px 0 0" };
