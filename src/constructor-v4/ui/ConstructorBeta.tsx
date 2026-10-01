import { lazy, Suspense, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { PageLayout } from "@/components/PageLayout";
import { usePageEngagement } from "@/hooks/usePageEngagement";

/**
 * Конструктор v4 (бета) внутри сайта. Сам конструктор — только на клиенте:
 * 3D, солвер и правила работают в браузере, сервер нужен лишь для чата,
 * голоса, рендеров и заявки (и без него редактор, план, бюджет и паспорт работают).
 */
const PilotApp = lazy(() => import("./PilotApp.tsx"));

export function ConstructorBeta() {
  usePageEngagement("constructor");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <PageLayout>
      <div className="border-b bg-amber-50 px-4 py-2 text-sm">
        <span className="mr-2 rounded bg-amber-500 px-2 py-0.5 text-xs font-semibold uppercase text-white">
          бета
        </span>
        Новый конструктор: расскажите о семье — соберём три варианта дома, план и бюджет. Цены и
        отделки предварительные.{" "}
        <Link to="/constructor" search={{ classic: true }} className="underline">
          Старый конструктор
        </Link>
      </div>
      {mounted ? (
        <Suspense fallback={<p className="p-6">Загружаем конструктор…</p>}>
          <PilotApp />
        </Suspense>
      ) : (
        <p className="p-6">Загружаем конструктор…</p>
      )}
    </PageLayout>
  );
}

export default ConstructorBeta;
