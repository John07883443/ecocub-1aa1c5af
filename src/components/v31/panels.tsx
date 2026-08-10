/**
 * Панели рабочего пространства v3.1: действия над домом, инструменты
 * участка, ключевые параметры, контекстное меню модуля и подтверждения.
 *
 * Панели ничего не считают сами — они читают производные данные из единого
 * состояния (useWorkspace) и вызывают доменные действия.
 */

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  Bath,
  BedDouble,
  BriefcaseBusiness,
  ChevronDown,
  CookingPot,
  DoorOpen,
  Info,
  Layers2,
  Redo2,
  RotateCcw,
  Sofa,
  Sparkles,
  TentTree,
  Trash2,
  Undo2,
  Warehouse,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CEILING_HEIGHT_M, MAX_FLOORS, ROOM_TYPES, ROOM_TYPE_ORDER } from "@/lib/v31/constants";
import { deleteImpact } from "@/lib/v31/useWorkspace";
import type { WorkspaceApi } from "@/lib/v31/useWorkspace";
import {
  applyPreset,
  clampSiteSide,
  COMPASS_LABELS,
  PLACEMENT_LABELS,
  SITE_DISCLAIMER,
} from "@/lib/v31/site";
import type { Compass, PlacementPreset, RoomType } from "@/lib/v31/types";

const fmt = (n: number) => new Intl.NumberFormat("ru-RU").format(Math.round(n));

/* ------------------------------------------------------------------ */
/* Действия над домом                                                  */
/* ------------------------------------------------------------------ */

const ROOM_ACTIONS: Array<{ type: RoomType; icon: typeof BedDouble; label: string }> = [
  { type: "entryway", icon: DoorOpen, label: "Добавить прихожую" },
  { type: "bedroom", icon: BedDouble, label: "Добавить спальню" },
  { type: "office", icon: BriefcaseBusiness, label: "Добавить кабинет" },
  { type: "kitchen", icon: CookingPot, label: "Кухня-гостиная" },
  { type: "living", icon: Sofa, label: "Добавить гостиную" },
  { type: "bathroom", icon: Bath, label: "Добавить санузел" },
  { type: "storage", icon: Warehouse, label: "Хранение и постирочная" },
  { type: "terrace", icon: TentTree, label: "Добавить террасу" },
];

export function HouseTools({ api, onClear }: { api: WorkspaceApi; onClear: () => void }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 lg:grid-cols-2">
        {ROOM_ACTIONS.map(({ type, icon: Icon, label }) => (
          <button
            key={type}
            type="button"
            onClick={() => api.addRoomAction(type)}
            className="flex min-h-[72px] flex-col items-start gap-1.5 rounded-sm border border-border p-3 text-left transition-colors hover:border-accent hover:bg-accent/5"
          >
            <Icon className="size-5 text-accent" strokeWidth={1.75} />
            <span className="text-xs font-semibold leading-tight">{label}</span>
            <span className="text-[10px] leading-tight text-muted-foreground">
              {ROOM_TYPES[type].hint}
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={api.areas.floors >= MAX_FLOORS}
          onClick={api.secondFloorAction}
        >
          <Layers2 className="size-4" /> Рассмотреть второй этаж
        </Button>
        <Button variant="outline" size="sm" onClick={api.mirrorAction}>
          <ArrowLeftRight className="size-4" /> Зеркально
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button variant="outline" size="sm" disabled={!api.canUndo} onClick={api.undo}>
          <Undo2 className="size-4" /> Отменить
        </Button>
        <Button variant="outline" size="sm" disabled={!api.canRedo} onClick={api.redo}>
          <Redo2 className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!api.house.modules.length}
          onClick={onClear}
          className="border-destructive/40 text-destructive hover:bg-destructive/5"
        >
          <Trash2 className="size-4" /> Очистить план
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Инструменты участка                                                 */
/* ------------------------------------------------------------------ */

const SIDES: Compass[] = ["north", "east", "south", "west"];
const PRESETS: PlacementPreset[] = ["west", "center", "east"];

export function SiteTools({ api }: { api: WorkspaceApi }) {
  const { site, house } = api;
  const hasHouse = house.modules.length > 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Ширина, м</span>
          <Input
            type="number"
            inputMode="numeric"
            value={site.widthM}
            onChange={(e) =>
              api.setSiteLive({ widthM: clampSiteSide(Number(e.target.value) || 12) })
            }
            onBlur={() => api.setSite({})}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Глубина, м</span>
          <Input
            type="number"
            inputMode="numeric"
            value={site.depthM}
            onChange={(e) =>
              api.setSiteLive({ depthM: clampSiteSide(Number(e.target.value) || 12) })
            }
            onBlur={() => api.setSite({})}
          />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        ≈ {((site.widthM * site.depthM) / 100).toFixed(1)} соток · отступ от границ {site.setbackM}{" "}
        м
      </p>

      <div>
        <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Сторона въезда на участок
        </span>
        <div className="flex flex-wrap gap-1.5">
          {SIDES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => api.setSite({ accessSide: s })}
              aria-pressed={site.accessSide === s}
              className={chip(site.accessSide === s)}
            >
              {COMPASS_LABELS[s]}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Схема нарисована севером вверх. Въезд — не то же самое, что входная дверь дома.
        </p>
      </div>

      <div>
        <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Положение дома
        </span>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              disabled={!hasHouse}
              onClick={() => api.setSite(applyPreset(house.modules, site, p))}
              aria-pressed={site.preset === p}
              className={chip(site.preset === p)}
            >
              {PLACEMENT_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Поворот дома</span>
        <div className="flex flex-wrap gap-1.5">
          {([0, 90, 180, 270] as const).map((r) => (
            <button
              key={r}
              type="button"
              disabled={!hasHouse}
              onClick={() => api.setSite({ houseRotation: r })}
              aria-pressed={site.houseRotation === r}
              className={chip(site.houseRotation === r)}
            >
              {r}°
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Дом двигается по участку целиком — планировка комнат при этом не меняется.
        </p>
      </div>

      <p className="rounded-sm border-l-2 border-accent bg-secondary p-3 text-[11px] leading-relaxed text-muted-foreground">
        {SITE_DISCLAIMER}
      </p>
    </div>
  );
}

function chip(active: boolean): string {
  return [
    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40",
    active
      ? "border-accent bg-accent/10"
      : "border-border text-muted-foreground hover:border-accent",
  ].join(" ");
}

/* ------------------------------------------------------------------ */
/* Ключевые параметры                                                  */
/* ------------------------------------------------------------------ */

export function KeyStats({ api }: { api: WorkspaceApi }) {
  const { areas, price } = api;
  const empty = areas.moduleCount === 0;
  return (
    <div className="rounded-sm border border-border">
      <dl className="grid grid-cols-2 gap-px bg-border">
        <Stat label="Площадь дома" value={empty ? "—" : `${areas.totalAreaM2} м²`} />
        <Stat label="Жилая площадь" value={empty ? "—" : `${areas.livingAreaM2} м²`} />
        <Stat label="Модулей" value={empty ? "—" : String(areas.moduleCount)} />
        <Stat label="Этажей" value={empty ? "—" : String(areas.floors)} />
        {areas.terraceAreaM2 > 0 && <Stat label="Террасы" value={`${areas.terraceAreaM2} м²`} />}
        <Stat label="Стоимость" value={empty ? "—" : `от ${fmt(price.price)} ₽`} accent />
      </dl>
      {/* Справочная характеристика продукта, а не поле ввода */}
      <p
        className="flex items-center gap-1.5 border-t border-border px-3 py-2 text-xs text-muted-foreground"
        title="315 см"
      >
        <Info className="size-3.5 text-accent" />
        Высота потолков — {CEILING_HEIGHT_M.toFixed(2).replace(".", ",")} м
      </p>
      {!empty && (
        <p className="border-t border-border px-3 py-2 text-[11px] leading-snug text-muted-foreground">
          {price.disclaimer}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-card px-3 py-2.5">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={["text-sm font-semibold", accent ? "text-accent" : ""].join(" ")}>{value}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Контекстное меню модуля                                             */
/* ------------------------------------------------------------------ */

export function ModuleMenu({
  api,
  moduleId,
  anchor,
  onClose,
}: {
  api: WorkspaceApi;
  moduleId: string;
  anchor: { x: number; y: number };
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [changeType, setChangeType] = useState(false);

  const module = api.house.modules.find((m) => m.id === moduleId);
  const room = module ? api.house.rooms.find((r) => r.id === module.roomId) : undefined;
  const layout = room ? api.house.layouts[room.id] : undefined;
  const roomModules = room ? api.house.modules.filter((m) => m.roomId === room.id) : [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    // Слушаем следующий цикл, чтобы открывающий тап не закрыл панель сразу.
    const t = window.setTimeout(() => window.addEventListener("pointerdown", onDown), 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
      window.clearTimeout(t);
    };
  }, [onClose]);

  if (!module || !room) return null;

  const impact = deleteImpact(api.house, moduleId);

  const doDelete = (confirmed: boolean) => {
    const result = api.deleteModuleAction(moduleId, confirmed);
    if (!result.ok && result.needsConfirm) setConfirmDelete(result.error);
    else onClose();
  };

  // Панель держится в пределах экрана и не перекрывает выбранный модуль целиком.
  const width = 264;
  const left = Math.min(Math.max(12, anchor.x - width / 2), window.innerWidth - width - 12);
  const top = Math.min(anchor.y + 16, window.innerHeight - 260);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Действия: ${ROOM_TYPES[room.type].label}`}
      className="fixed z-50 rounded-sm border border-border bg-background p-3 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.35)]"
      style={{ left, top, width }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{ROOM_TYPES[room.type].label}</p>
          <p className="text-[11px] text-muted-foreground">
            {roomModules.length * 9} м² · {module.floor + 1}-й этаж · секция 3 × 3 м
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть"
          className="rounded p-1 text-muted-foreground hover:bg-secondary"
        >
          <X className="size-4" />
        </button>
      </div>

      {confirmDelete ? (
        <div className="mt-3 rounded-sm border border-destructive/40 bg-destructive/5 p-2.5">
          <p className="text-xs text-destructive">{confirmDelete}</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setConfirmDelete(null)}>
              Отмена
            </Button>
            <Button
              size="sm"
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => doDelete(true)}
            >
              Всё равно удалить
            </Button>
          </div>
        </div>
      ) : changeType ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {ROOM_TYPE_ORDER.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                api.changeRoomTypeAction(room.id, t);
                setChangeType(false);
              }}
              className={chip(room.type === t)}
            >
              {ROOM_TYPES[t].label}
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-3 space-y-1.5">
          {layout && layout.presetCount > 1 && (
            <MenuButton icon={Sparkles} onClick={() => api.otherLayoutAction(room.id)}>
              Другой вариант расстановки
            </MenuButton>
          )}
          <MenuButton icon={RotateCcw} onClick={() => api.growRoomAction(room.id)}>
            Увеличить помещение
          </MenuButton>
          <MenuButton icon={ChevronDown} onClick={() => setChangeType(true)}>
            Изменить назначение
          </MenuButton>
          <MenuButton icon={Trash2} danger onClick={() => doDelete(false)}>
            Удалить модуль
          </MenuButton>
          {impact && (impact.breaksConnectivity || impact.losesSupport > 0) && (
            <p className="pt-1 text-[11px] text-muted-foreground">
              Удаление затронет связность дома — спросим подтверждение.
            </p>
          )}
          {layout?.fallback && layout.warnings.length > 0 && (
            <p className="pt-1 text-[11px] text-muted-foreground">{layout.warnings[0]}</p>
          )}
        </div>
      )}
    </div>
  );
}

function MenuButton({
  icon: Icon,
  children,
  onClick,
  danger,
}: {
  icon: typeof Trash2;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex min-h-11 w-full items-center gap-2 rounded-sm px-2.5 text-left text-sm transition-colors",
        danger ? "text-destructive hover:bg-destructive/5" : "hover:bg-secondary",
      ].join(" ")}
    >
      <Icon className="size-4" />
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Подтверждение очистки                                               */
/* ------------------------------------------------------------------ */

export function ClearDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-sm border border-border bg-background p-5">
        <p className="text-base font-semibold">Очистить весь план?</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Будут удалены помещения и террасы на всех этажах. Ответы квиза, профиль семьи и параметры
          участка сохранятся. Действие можно отменить.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            Отмена
          </Button>
          <Button className="bg-destructive text-white hover:bg-destructive/90" onClick={onConfirm}>
            Очистить план
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Пустое состояние                                                    */
/* ------------------------------------------------------------------ */

export function EmptyState({ api }: { api: WorkspaceApi }) {
  return (
    <div className="rounded-sm border border-dashed border-border bg-card p-6 text-center">
      <p className="text-base font-semibold">Начните с первого пространства</p>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
        Добавьте прихожую, кухню-гостиную или спальню — план и объём соберутся сразу.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Button size="sm" variant="outline" onClick={() => api.addRoomAction("entryway")}>
          <DoorOpen className="size-4" /> Добавить прихожую
        </Button>
        <Button size="sm" variant="outline" onClick={() => api.addRoomAction("kitchen")}>
          <CookingPot className="size-4" /> Добавить кухню-гостиную
        </Button>
        <Button size="sm" variant="outline" onClick={api.restoreBaseAction}>
          <RotateCcw className="size-4" /> Вернуть исходный вариант
        </Button>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        «Вернуть исходный вариант» — не то же самое, что «Отменить»: он восстанавливает
        рекомендованную планировку целиком.
      </p>
    </div>
  );
}
