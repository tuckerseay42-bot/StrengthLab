import { createFileRoute, Navigate } from "@tanstack/react-router";

// Legacy detail route consolidated into /programming
export const Route = createFileRoute("/programs/$id")({
  component: RedirectToProgramming,
});

function RedirectToProgramming() {
  const { id } = Route.useParams();
  return <Navigate to="/programming" search={{ program: id }} replace />;
}
