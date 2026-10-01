import { createFileRoute, redirect } from "@tanstack/react-router";

/** /pilot — бывший адрес локального пилота; конструктор v4 теперь на /constructor. */
export const Route = createFileRoute("/pilot")({
  beforeLoad: () => {
    throw redirect({ to: "/constructor" });
  },
});
