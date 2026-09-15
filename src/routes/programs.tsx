import { createFileRoute, Navigate } from "@tanstack/react-router";

// Legacy list route consolidated into /programming
export const Route = createFileRoute("/programs")({
  component: () => <Navigate to="/programming" replace />,
});
