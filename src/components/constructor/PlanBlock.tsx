import { useMemo } from "react";

import { houseFromModules } from "@/lib/planner/zoning";
import { computeAreas } from "@/lib/planner/rooms";
import { ROOM_TYPES } from "@/lib/planner/constants";
import { auditHouse, errors } from "@/lib/planner/audit";
import type { ModuleItem } from "@/lib/constructor/types";

import { PlanView } from "./plan/PlanView";

/**
 * Блок «Планировка дома» под конструктором.
 *
 * Заменил генерацию нейросетью. Та получала точный контур и весь свод правил
 * и всё равно рисовала выдуманную квартиру: санузел посреди гостиной, дверь в
 * глухую стену. Здесь планировка вычисляется из размеров — по модулю альбома
 * Weekend One и приёмам, снятым с семи построенных проектов.
 *
 * Что это даёт человеку помимо картинки: план перестраивается мгновенно при
 * каждом изменении дома, не стоит денег, не требует ожидания и показывает
 * одно и то же при каждом открытии страницы.
 */
export function PlanBlock({ modules }: { modules: ModuleItem[] }) {
  const house = useMemo(() => houseFromModules(modules), [modules]);
  const areas = useMemo(() => computeAreas(house), [house]);

  const ground = house.rooms.filter((r) => r.floor === 0);
  if (!ground.length) return null;

  // Помещения, которым планировщик не смог подобрать расстановку. Молчать о
  // них нельзя: пустая комната на чертеже выглядит как недоделка, а причина
  // всегда конкретная — модуль зажат соседями и мебель не встаёт по нормам.
  const unresolved = ground.filter(
    (r) =>
      r.type !== "terrace" && r.type !== "entryway" && !(house.layouts[r.id]?.items ?? []).length,
  );

  // Аудит гоняется и в тестах по всем формам дома, и здесь, на живой сборке.
  // Если инвариант всё-таки нарушен, честнее сказать об этом прямо, чем
  // показать чертёж, по которому нельзя жить.
  const problems = errors(auditHouse(house));

  return (
    <section className="mt-6 rounded-sm border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground">
          Планировка дома
        </h3>
        <span className="text-xs text-muted-foreground">
          {ground.length} помещени{ending(ground.length)} · {areas.totalAreaM2.toFixed(1)} м²
        </span>
      </div>

      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Схема собирается автоматически по вашему набору кубиков: стены, двери, окна и мебель
        расставлены по стандарту EcoCub. Это концепция для понимания масштаба — точную планировку
        инженер уточняет при подготовке проекта.
      </p>

      <div className="mt-4 overflow-hidden rounded-sm border border-border bg-background">
        <PlanView house={house} />
      </div>

      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {ground.map((room) => (
          <li key={room.id}>
            {ROOM_TYPES[room.type].label}
            {(house.layouts[room.id]?.items ?? []).length === 0 && " — без мебели"}
          </li>
        ))}
      </ul>

      {problems.length > 0 && (
        <p className="mt-3 text-xs text-foreground">
          Схему стоит проверить инженеру: {problems.map((p) => p.message.toLowerCase()).join("; ")}.
        </p>
      )}

      {unresolved.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {unresolved.length === 1 ? "Одно помещение" : `${unresolved.length} помещения`} осталось
          без расстановки: модуль зажат соседями, и мебель не встаёт без нарушения проходов.
          Подвиньте кубик — схема пересоберётся.
        </p>
      )}
    </section>
  );
}

function ending(n: number): string {
  const last = n % 10;
  const teen = n % 100 >= 11 && n % 100 <= 14;
  if (!teen && last === 1) return "е";
  if (!teen && last >= 2 && last <= 4) return "я";
  return "й";
}
