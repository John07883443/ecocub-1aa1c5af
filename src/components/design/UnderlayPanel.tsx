import { useRef, useState } from "react";
import { Eye, EyeOff, Lock, LockOpen, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DesignEditor } from "@/lib/house-project/editor";
import type { UnderlayConfig } from "@/lib/house-project/types";

/**
 * Чертёж-подложка и её калибровка.
 *
 * Смысл всего экрана — обратное проектирование: под план кладётся скан листа,
 * и модули расставляются поверх него. Чтобы это работало, у изображения
 * должен быть честный масштаб, а не подобранный ползунком «на глаз».
 *
 * Калибровка делается по известному размеру: человек вводит расстояние между
 * двумя точками чертежа в пикселях и то же расстояние в миллиметрах с
 * размерной цепочки. Отсюда получается `mmPerPx`, и дальше подложка живёт в
 * тех же миллиметрах, что и модель, при любом приближении.
 *
 * PDF намеренно не поддерживается: в проекте нет ни одной библиотеки для его
 * разбора, а тянуть её ради подложки — лишние сотни килобайт в бандл. Лист
 * экспортируется в PNG любым просмотрщиком.
 */
export function UnderlayPanel({ editor }: { editor: DesignEditor }) {
  const { state, dispatch } = editor;
  const underlay = state.project.underlay;
  const fileRef = useRef<HTMLInputElement>(null);
  const [calib, setCalib] = useState({ px: 0, mm: 0 });

  const set = (patch: Partial<UnderlayConfig>) => {
    if (!underlay) return;
    dispatch({ type: "patch-project", patch: { underlay: { ...underlay, ...patch } } });
  };

  const load = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result ?? "");
      if (!src.startsWith("data:image/")) return;
      dispatch({
        type: "patch-project",
        patch: {
          underlay: {
            src,
            floor: state.activeFloor,
            // Стартовый масштаб заведомо неверный и таким и подаётся: без
            // калибровки подложка — просто картинка под планом.
            mmPerPx: 10,
            offsetMm: { x: 0, y: 0 },
            rotationDeg: 0,
            opacity: 0.45,
            locked: false,
            visible: true,
          },
        },
      });
    };
    reader.readAsDataURL(file);
  };

  if (!underlay) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Положите под план скан листа — и расставляйте модули прямо по чертежу. Масштаб задаётся по
          известному размеру, а не подбирается на глаз.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) load(file);
            e.target.value = "";
          }}
        />
        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
          <Upload className="size-4" /> Загрузить PNG или JPG
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-1">
        <Button variant="outline" size="sm" onClick={() => set({ visible: !underlay.visible })}>
          {underlay.visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
          {underlay.visible ? "Видна" : "Скрыта"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => set({ locked: !underlay.locked })}>
          {underlay.locked ? <Lock className="size-4" /> : <LockOpen className="size-4" />}
          {underlay.locked ? "Закреплена" : "Свободна"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive"
          onClick={() => dispatch({ type: "patch-project", patch: { underlay: undefined } })}
        >
          <Trash2 className="size-4" /> Убрать
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Этаж</span>
          <select
            value={underlay.floor}
            onChange={(e) => set({ floor: Number(e.target.value) })}
            className="mt-1 h-8 w-full rounded-sm border border-input bg-background px-2 text-sm"
          >
            {[0, 1, 2].map((f) => (
              <option key={f} value={f}>
                {f + 1}-й
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Прозрачность
          </span>
          <Input
            type="range"
            min={0.05}
            max={1}
            step={0.05}
            value={underlay.opacity}
            onChange={(e) => set({ opacity: Number(e.target.value) })}
            className="mt-1 h-8"
          />
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">X, мм</span>
          <Input
            type="number"
            step={10}
            disabled={underlay.locked}
            value={underlay.offsetMm.x}
            onChange={(e) =>
              set({ offsetMm: { ...underlay.offsetMm, x: Math.round(Number(e.target.value)) } })
            }
            className="mt-1 h-8"
          />
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Y, мм</span>
          <Input
            type="number"
            step={10}
            disabled={underlay.locked}
            value={underlay.offsetMm.y}
            onChange={(e) =>
              set({ offsetMm: { ...underlay.offsetMm, y: Math.round(Number(e.target.value)) } })
            }
            className="mt-1 h-8"
          />
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Поворот, °
          </span>
          <Input
            type="number"
            step={0.5}
            disabled={underlay.locked}
            value={underlay.rotationDeg}
            onChange={(e) => set({ rotationDeg: Number(e.target.value) })}
            className="mt-1 h-8"
          />
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            мм в пикселе
          </span>
          <Input
            type="number"
            step={0.01}
            disabled={underlay.locked}
            value={underlay.mmPerPx}
            onChange={(e) => set({ mmPerPx: Math.max(0.01, Number(e.target.value)) })}
            className="mt-1 h-8"
          />
        </label>
      </div>

      <div className="rounded-sm bg-muted/60 p-3">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Калибровка по известному размеру
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="number"
            placeholder="пикселей на чертеже"
            value={calib.px || ""}
            onChange={(e) => setCalib((c) => ({ ...c, px: Number(e.target.value) }))}
            className="h-8"
          />
          <Input
            type="number"
            placeholder="это же в мм"
            value={calib.mm || ""}
            onChange={(e) => setCalib((c) => ({ ...c, mm: Number(e.target.value) }))}
            className="h-8"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          disabled={!calib.px || !calib.mm || underlay.locked}
          onClick={() =>
            set({
              mmPerPx: calib.mm / calib.px,
              calibration: {
                aPx: { x: 0, y: 0 },
                bPx: { x: calib.px, y: 0 },
                knownMm: calib.mm,
              },
            })
          }
        >
          Задать масштаб
        </Button>
        {underlay.calibration && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Задано: {underlay.calibration.knownMm} мм на{" "}
            {Math.round(underlay.calibration.bPx.x - underlay.calibration.aPx.x)} px →{" "}
            {underlay.mmPerPx.toFixed(3)} мм/px.
          </p>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Подложка хранится в черновике и наружу не публикуется: на странице каталога исходный чертёж
        не показывается.
      </p>
    </div>
  );
}
