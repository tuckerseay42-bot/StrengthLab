import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/reports" });
  },
  head: () => ({
    meta: [
      { title: "Strength Lab Hub — Performance Reports" },
      { name: "description", content: "Free performance report builders from Strength Lab Hub, plus coach and athlete sign in." },
      { property: "og:title", content: "Strength Lab Hub — Performance Reports" },
      { property: "og:description", content: "Performance report builders plus coach and athlete sign in." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => null,
});
