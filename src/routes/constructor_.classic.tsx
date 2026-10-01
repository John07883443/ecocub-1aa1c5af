import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * /constructor/classic — прежний конструктор (кубики 3 × 3). Живёт на /constructor?classic=1,
 * этот адрес — постоянная ссылка на него. ?house= сохраняется.
 */
export const Route = createFileRoute("/constructor_/classic")({
  beforeLoad: ({ search }) => {
    const house =
      typeof (search as Record<string, unknown>).house === "string"
        ? (search as { house: string }).house
        : undefined;
    throw redirect({ to: "/constructor", search: { classic: true, ...(house ? { house } : {}) } });
  },
});
