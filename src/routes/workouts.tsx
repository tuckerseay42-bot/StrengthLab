import { createFileRoute, Navigate } from "@tanstack/react-router";

// Legacy Session Builder list consolidated into /programming
export const Route = createFileRoute("/workouts")({
  component: () => <Navigate to="/programming" replace />,
});
