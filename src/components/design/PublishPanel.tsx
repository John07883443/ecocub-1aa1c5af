import { useState } from "react";
import { Archive, Camera, Copy, ExternalLink, Send, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { DesignEditor } from "@/lib/house-project/editor";
import { computeMetrics } from "@/lib/house-project/geometry";
import { slugify } from "@/lib/house-project/factory";
import { formatArea, formatBounds } from "@/lib/house-projects";
import type { HouseProject } from "@/lib/house-project/types";

/**
 * Карточка каталога и операции над публикацией.
 *
 * Расчётные характеристики показаны здесь же и не редактируются: их считает
 * геометрия. Маркетинговая площадь вводится отдельным полем и помечена — так
 * видно, что число «55 м²» из презентации не то же самое, что тёплый контур
 * 43,8, и одно не подменяет другое незаметно.
 */
export function PublishPanel({
  editor,
  onAction,
  onCapture,
  busy,
}: {
  editor: DesignEditor;
  onAction: (action: "publish" | "unpublish" | "archive" | "duplicate") => void;
  onCapture: () => Promise<void>;
  busy: boolean;
}) {
  const { state, dispatch } = editor;
  const project = state.project;
  const metrics = computeMetrics(project.model);
  const [capturing, setCapturing] = useState(false);

  const patch = (p: Partial<HouseProject>) => dispatch({ type: "patch-project", patch: p });
  const patchPublication = (p: Partial<HouseProject["publication"]>) =>
    patch({ publication: { ...project.publication, ...p } });

  return (
    <div className="space-y-4 text-sm">
      <label className="block">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Название</span>
        <Input
          value={project.title}
          onChange={(e) => patch({ title: e.target.value })}
          className="mt-1 h-8"
        />
      </label>

      <label className="block">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Адрес страницы
        </span>
        <span className="mt-1 flex items-center gap-1">
          <span className="text-[11px] text-muted-foreground">/houses/</span>
          <Input
            value={project.slug}
            onChange={(e) => patch({ slug: slugify(e.target.value) })}
            className="h-8"
          />
        </span>
      </label>

      <label className="block">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Описание</span>
        <Textarea
          value={project.description ?? ""}
          onChange={(e) => patch({ description: e.target.value || undefined })}
          rows={4}
          className="mt-1 text-sm"
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Цена «от», ₽
          </span>
          <Input
            type="number"
            value={project.publication.priceFrom ?? ""}
            onChange={(e) =>
              patchPublication({
                priceFrom: e.target.value ? Math.max(0, Number(e.target.value)) : undefined,
              })
            }
            className="mt-1 h-8"
          />
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Площадь в рекламе, м²
          </span>
          <Input
            type="number"
            value={project.publication.marketingAreaM2 ?? ""}
            onChange={(e) =>
              patchPublication({
                marketingAreaM2: e.target.value ? Number(e.target.value) : undefined,
              })
            }
            className="mt-1 h-8"
          />
        </label>
      </div>

      <label className="block">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Особенности, по одной в строке
        </span>
        <Textarea
          value={project.publication.highlights.join("\n")}
          onChange={(e) =>
            patchPublication({
              highlights: e.target.value
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          rows={4}
          className="mt-1 text-sm"
        />
      </label>

      <label className="block">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Теги через запятую
        </span>
        <Input
          value={project.publication.tags.join(", ")}
          onChange={(e) =>
            patchPublication({
              tags: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          className="mt-1 h-8"
        />
      </label>

      <div className="space-y-2">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Обложка</span>
        {project.publication.coverImage ? (
          <img
            src={project.publication.coverImage}
            alt="Обложка проекта"
            className="aspect-[4/3] w-full rounded-sm border border-border object-cover"
          />
        ) : (
          <p className="rounded-sm bg-muted/60 px-3 py-4 text-center text-[12px] text-muted-foreground">
            Обложки нет. Без неё публикация невозможна.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={capturing}
            onClick={async () => {
              setCapturing(true);
              try {
                await onCapture();
              } finally {
                setCapturing(false);
              }
            }}
          >
            <Camera className="size-4" />
            {capturing ? "Снимаю…" : "Кадр из 3D"}
          </Button>
        </div>
        <Input
          value={project.publication.coverImage ?? ""}
          placeholder="/images/projects/…jpg — или свой адрес"
          onChange={(e) => patchPublication({ coverImage: e.target.value || undefined })}
          className="h-8 text-xs"
        />
      </div>

      <div className="rounded-sm bg-muted/60 p-3 text-[12px] leading-relaxed text-muted-foreground">
        <p className="mb-1 font-medium text-foreground">Считается из модели</p>
        <p>
          Модулей: {metrics.moduleCount}, этажей: {metrics.floors}
        </p>
        <p>Жилая площадь: {formatArea(metrics.livingAreaM2)} (тёплый контур)</p>
        <p>Застройка: {formatArea(metrics.footprintAreaM2)}</p>
        <p>Габарит: {formatBounds(metrics.boundsMm.widthMm, metrics.boundsMm.depthMm)}</p>
        <p>
          Проёмы: окон {metrics.openings.windows}, дверей {metrics.openings.doors}, витражей{" "}
          {metrics.openings.panoramic}, открытых {metrics.openings.passages}
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        {project.status === "published" ? (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onAction("unpublish")}
            >
              <Undo2 className="size-4" /> Снять с публикации
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={`/houses/${project.slug}`} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-4" /> Открыть страницу
              </a>
            </Button>
          </>
        ) : (
          <Button size="sm" disabled={busy} onClick={() => onAction("publish")}>
            <Send className="size-4" /> Опубликовать
          </Button>
        )}
        <Button variant="outline" size="sm" disabled={busy} onClick={() => onAction("duplicate")}>
          <Copy className="size-4" /> Дублировать
        </Button>
        {project.status !== "archived" && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => onAction("archive")}>
            <Archive className="size-4" /> В архив
          </Button>
        )}
      </div>
    </div>
  );
}
