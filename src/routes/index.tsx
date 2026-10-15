import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/performance" });
  },
  head: () => ({
    meta: [{ title: "Strength Lab — Performance OS" }],
  }),
  component: () => null,
});
