import { createFileRoute, Navigate } from "@tanstack/react-router";

// Legacy workout editor consolidated into /programming
export const Route = createFileRoute("/workouts/$id")({
  component: RedirectToProgramming,
});

function RedirectToProgramming() {
  const { id } = Route.useParams();
  return <Navigate to="/programming" search={{ workout: id }} replace />;
}
