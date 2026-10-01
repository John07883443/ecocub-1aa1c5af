import { lazy, Suspense, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

/**
 * Пилот конструктора v4 — только для локального запуска (`npm run pilot`).
 * В обычной сборке сайта страница показывает заглушку и закрыта от индексации:
 * ключи и сервер пилота живут только на машине владельца.
 */
const PilotApp = lazy(() => import("@/constructor-v4/ui/PilotApp"));
const ENABLED = import.meta.env.DEV || import.meta.env.VITE_PILOT === "1";

export const Route = createFileRoute("/pilot")({
  head: () => ({
    meta: [
      { title: "ЭкоКуб — пилот конструктора v4" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: PilotPage,
});

function PilotPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!ENABLED) return <p style={{ padding: 24 }}>Пилот доступен только при локальном запуске.</p>;
  if (!mounted) return <p style={{ padding: 24 }}>Загрузка пилота…</p>;
  return (
    <Suspense fallback={<p style={{ padding: 24 }}>Загрузка пилота…</p>}>
      <PilotApp />
    </Suspense>
  );
}
