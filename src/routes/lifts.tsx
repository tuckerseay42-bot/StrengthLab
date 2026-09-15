import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/lifts")({
  beforeLoad: () => {
    throw redirect({ to: "/exercises", search: { tab: "lifts" } });
  },
});
