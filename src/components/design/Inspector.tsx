import { Copy, RotateCcw, RotateCw, Trash2, FlipHorizontal2, MoveVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OPENING_PRESETS, findOpeningPreset } from "@/lib/house-project/catalog";
import type { DesignEditor } from "@/lib/house-project/editor";
import {
  defOf,
  footprintOf,
  localFace,
  moduleLevelMm,
  supportAreaMm2,
} from "@/lib/house-project/geometry";
import type { DoorSwing, FaceId, OpeningKind } from "@/lib/house-project/types";
import { FACE_IDS } from "@/lib/house-project/types";

/**
 * Инспектор — числовая половина редактора.
 *
 * Мышью удобно расставлять, но воспроизводить чертёж мышью нельзя: 3200 от
 * 3193 на экране не отличить. Поэтому всё, что можно подвинуть перетаскиванием,
 * здесь же вводится числом, и число — главное. Поля показывают миллиметры без
 * округления и без «м²» — ровно те цифры, что стоят на размерной цепочке.
 */

const KIND_LABELS: Record<OpeningKind, string> = {
  window: "Окно",
  door: "Дверь",
  panoramic: "Витраж",
  passage: "Открытый проём",
};

const SWING_LABELS: Record<DoorSwing, string> = {
  "in-left": "Внутрь, левая",
  "in-right": "Внутрь, правая",
  "out-left": "Наружу, левая",
  "out-right": "Наружу, правая",
};

function NumberField({
  label,
  value,
  onChange,
  step = 10,
  suffix = "мм",
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  suffix?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="mt-1 flex items-center gap-1">
        <Input
          type="number"
          step={step}
          value={Number.isFinite(value) ? value : 0}
          disabled={disabled}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (Number.isFinite(next)) onChange(Math.round(next));
          }}
          className="h-8 text-sm"
        />
        <span className="w-8 shrink-0 text-[11px] text-muted-foreground">{suffix}</span>
      </span>
    </label>
  );
}

export function Inspector({ editor }: { editor: DesignEditor }) {
  const { state, dispatch, selectedModules, selectedOpening } = editor;
  const modules = state.project.model.modules;

  if (selectedOpening) {
    const module = modules.find((m) => m.id === selectedOpening.moduleId);
    const def = module ? defOf(module) : null;
    const span = module && def ? localFace(def, selectedOpening.faceId).spanMm : 0;
    const preset = selectedOpening.variantId
      ? findOpeningPreset(
          OPENING_PRESETS.find((p) => p.variantId === selectedOpening.variantId)?.id ?? "",
        )
      : undefined;

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Проём</h3>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={() => dispatch({ type: "delete-opening", id: selectedOpening.id })}
          >
            <Trash2 className="size-4" /> Удалить
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Тип</span>
            <select
              value={selectedOpening.kind}
              onChange={(e) =>
                dispatch({
                  type: "patch-opening",
                  id: selectedOpening.id,
                  patch: { kind: e.target.value as OpeningKind },
                })
              }
              className="mt-1 h-8 w-full rounded-sm border border-input bg-background px-2 text-sm"
            >
              {Object.entries(KIND_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Грань</span>
            <select
              value={selectedOpening.faceId}
              onChange={(e) =>
                dispatch({
                  type: "patch-opening",
                  id: selectedOpening.id,
                  patch: { faceId: e.target.value as FaceId },
                })
              }
              className="mt-1 h-8 w-full rounded-sm border border-input bg-background px-2 text-sm"
            >
              {FACE_IDS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>

          <NumberField
            label="Смещение по грани"
            value={selectedOpening.offsetMm}
            onChange={(v) =>
              dispatch({ type: "patch-opening", id: selectedOpening.id, patch: { offsetMm: v } })
            }
          />
          <NumberField
            label="Ширина"
            value={selectedOpening.widthMm}
            onChange={(v) =>
              dispatch({ type: "patch-opening", id: selectedOpening.id, patch: { widthMm: v } })
            }
          />
          <NumberField
            label="Низ от пола"
            value={selectedOpening.sillMm}
            onChange={(v) =>
              dispatch({ type: "patch-opening", id: selectedOpening.id, patch: { sillMm: v } })
            }
          />
          <NumberField
            label="Высота проёма"
            value={selectedOpening.heightMm}
            onChange={(v) =>
              dispatch({ type: "patch-opening", id: selectedOpening.id, patch: { heightMm: v } })
            }
          />
        </div>

        {selectedOpening.kind === "door" && (
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Открывание
            </span>
            <select
              value={selectedOpening.swing ?? ""}
              onChange={(e) =>
                dispatch({
                  type: "patch-opening",
                  id: selectedOpening.id,
                  patch: { swing: (e.target.value || undefined) as DoorSwing | undefined },
                })
              }
              className="mt-1 h-8 w-full rounded-sm border border-input bg-background px-2 text-sm"
            >
              <option value="">не задано</option>
              {Object.entries(SWING_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="rounded-sm bg-muted/60 p-3 text-[11px] leading-relaxed text-muted-foreground">
          <p>
            Длина грани {selectedOpening.faceId}: <b>{span} мм</b>. Верх проёма:{" "}
            <b>{selectedOpening.sillMm + selectedOpening.heightMm} мм</b> от чистого пола при высоте
            помещения {def?.clearHeightMm ?? 3150} мм.
          </p>
          {preset ? (
            <p className="mt-2">{preset.note}</p>
          ) : (
            <p className="mt-2">
              Размер не привязан к варианту из стандарта — проверка отметит его как требующий сверки
              с чертежом.
            </p>
          )}
        </div>
      </div>
    );
  }

  if (!selectedModules.length) {
    return (
      <p className="text-sm text-muted-foreground">
        Выберите модуль на плане, чтобы ввести точные координаты, или нажмите на его грань, чтобы
        поставить проём.
      </p>
    );
  }

  const single = selectedModules.length === 1 ? selectedModules[0] : null;
  const ids = selectedModules.map((m) => m.id);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {single ? `Модуль ${single.id}` : `Выбрано модулей: ${selectedModules.length}`}
        </h3>
      </div>

      <div className="flex flex-wrap gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => dispatch({ type: "rotate", ids, direction: -1 })}
        >
          <RotateCcw className="size-4" /> 90°
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => dispatch({ type: "rotate", ids, direction: 1 })}
        >
          <RotateCw className="size-4" /> 90°
        </Button>
        <Button variant="outline" size="sm" onClick={() => dispatch({ type: "mirror", ids })}>
          <FlipHorizontal2 className="size-4" /> Отразить
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => dispatch({ type: "duplicate-modules", ids })}
        >
          <Copy className="size-4" /> Дублировать
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive"
          onClick={() => dispatch({ type: "delete-modules", ids })}
        >
          <Trash2 className="size-4" /> Удалить
        </Button>
      </div>

      {single && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="X (левый край)"
              value={single.positionMm.x}
              onChange={(v) =>
                dispatch({
                  type: "patch-module",
                  id: single.id,
                  patch: { positionMm: { ...single.positionMm, x: v } },
                })
              }
            />
            <NumberField
              label="Y (нижний край)"
              value={single.positionMm.y}
              onChange={(v) =>
                dispatch({
                  type: "patch-module",
                  id: single.id,
                  patch: { positionMm: { ...single.positionMm, y: v } },
                })
              }
            />
            <NumberField
              label="Поправка отметки"
              value={single.elevationOffsetMm ?? 0}
              onChange={(v) =>
                dispatch({
                  type: "patch-module",
                  id: single.id,
                  patch: { elevationOffsetMm: v === 0 ? undefined : v },
                })
              }
            />
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Этаж
              </span>
              <select
                value={single.floor}
                onChange={(e) =>
                  dispatch({
                    type: "move-to-floor",
                    ids: [single.id],
                    floor: Number(e.target.value),
                  })
                }
                className="mt-1 h-8 w-full rounded-sm border border-input bg-background px-2 text-sm"
              >
                {[0, 1, 2].map((f) => (
                  <option key={f} value={f}>
                    {f + 1}-й
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Заметка проектировщика
            </span>
            <Input
              value={single.note ?? ""}
              placeholder="Например: лист 12, модуль A"
              onChange={(e) =>
                dispatch({
                  type: "patch-module",
                  id: single.id,
                  patch: { note: e.target.value || undefined },
                })
              }
              className="mt-1 h-8 text-sm"
            />
          </label>

          <div className="rounded-sm bg-muted/60 p-3 text-[11px] leading-relaxed text-muted-foreground">
            <p>
              Габарит в плане:{" "}
              <b>
                {footprintOf(single).widthMm} × {footprintOf(single).depthMm} мм
              </b>
              , поворот {single.rotationDeg}°{single.mirrored ? ", отражён" : ""}.
            </p>
            <p className="mt-1 flex items-center gap-1">
              <MoveVertical className="size-3" /> Чистый пол: <b>{moduleLevelMm(single)} мм</b> от
              пола первого этажа.
            </p>
            {single.floor > 0 && (
              <p className="mt-1">
                Опирание:{" "}
                <b>
                  {Math.round(
                    (supportAreaMm2(single, modules) /
                      (footprintOf(single).widthMm * footprintOf(single).depthMm)) *
                      100,
                  )}
                  %
                </b>{" "}
                площади модуля.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
