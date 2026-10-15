import { createFileRoute, Outlet } from "@tanstack/react-router";

// Today/Calendar/Assigned/Completed/Analytics are each already their own
// item in the main sidebar — this layout used to repeat most of them in a
// second tab strip above the page, so every Training page rendered two
// overlapping nav systems. Live (Facility view) stays reachable from
// Training View's own "Facility view" link instead of adding a 6th tab.
export const Route = createFileRoute("/training")({
  head: () => ({ meta: [{ title: "Training — Strength Lab" }] }),
  component: () => <Outlet />,
});
