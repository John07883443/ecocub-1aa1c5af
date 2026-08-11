import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Check,
  CloudOff,
  Download,
  FilePlus2,
  Grid3x3,
  Loader2,
  MousePointer2,
  Redo2,
  Ruler,
  Save,
  Undo2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OPENING_PRESETS } from "@/lib/house-project/catalog";
import { useDesignEditor } from "@/lib/house-project/editor";
import { createProject } from "@/lib/house-project/factory";
import { computeMetrics } from "@/lib/house-project/geometry";
import { exportProjectJson, importProjectJson } from "@/lib/house-project/serialize";
import { SNAP_STEPS } from "@/lib/house-project/snap";
import { validateProject } from "@/lib/house-project/validate";
import type { FaceId, HouseProject, ProjectSummary } from "@/lib/house-project/types";
import {
  ApiError,
  clearStashedDraft,
  designApi,
  stashDraft,
  takeStashedDraft,
} from "@/lib/design-api";
import { formatArea } from "@/lib/house-projects";
import { cn } from "@/lib/utils";
import { Inspector } from "./Inspector";
import { PlanCanvas, type Tool } from "./PlanCanvas";
import { PublishPanel } from "./PublishPanel";
import { UnderlayPanel } from "./UnderlayPanel";
import { ValidationPanel } from "./ValidationPanel";

const HouseView3D = lazy(() => import("./HouseView3D"));

/**
 * Рабочее место проектировщика.
 *
 * Один экран, три колонки: список проектов, план и числовая панель. Разносить
 * это по страницам нельзя — работа идёт короткими циклами «подвинул, посмотрел
 * число, проверил по чертежу», и переход между экранами на каждом цикле
 * убивал бы темп.
 *
 * Автосохранение с задержкой: правки летят на сервер сами, но не на каждый
 * ввод цифры в поле. Индикатор состояния показан всегда — «сохранено» без
 * доказательства это худший вид интерфейса.
 */

const AUTOSAVE_DELAY_MS = 1500;

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export function DesignStudio() {
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [devMode, setDevMode] = useState(false);
  const [secret, setSecret] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  const [list, setList] = useState<ProjectSummary[]>([]);
  const [storage, setStorage] = useState<{ writable: boolean; reason?: string }>({
    writable: true,
  });
  const [busy, setBusy] = useState(false);

  const editor = useDesignEditor(useMemo(() => createProject("Загрузка…"), []));
  const { state, dispatch } = editor;
  const project = state.project;

  const [tool, setTool] = useState<Tool>("select");
  const [snapStepMm, setSnapStepMm] = useState(SNAP_STEPS[0].value);
  const [showOtherFloors, setShowOtherFloors] = useState(true);
  const [view, setView] = useState<"plan" | "3d">("plan");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [facePick, setFacePick] = useState<{ moduleId: string; faceId: FaceId } | null>(null);

  const viewportRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const loadedId = useRef<string | null>(null);

  const issues = useMemo(() => validateProject(project), [project]);
  const metrics = useMemo(() => computeMetrics(project.model), [project.model]);

  /* --- Сессия и список ------------------------------------------------ */

  const refreshList = useCallback(async () => {
    try {
      const body = await designApi.list();
      setList(body.projects);
      setStorage(body.storage);
      return body.projects;
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setAllowed(false);
      return [];
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await designApi.session();
        if (cancelled) return;
        setConfigured(session.configured);
        setAllowed(session.allowed);
        setDevMode(session.mode === "dev");
        if (session.allowed) {
          const projects = await refreshList();
          if (!cancelled && projects.length) await open(projects[0].id);
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Открытие первого проекта выполняется один раз при монтировании.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = useCallback(
    async (id: string) => {
      try {
        const { project: loaded } = await designApi.get(id);
        // Аварийная копия из localStorage применяется только если она свежее
        // серверной: иначе вчерашний черновик перетёр бы сегодняшнюю работу.
        const stashed = takeStashedDraft(loaded.id);
        const useStash = stashed && stashed.updatedAt > loaded.updatedAt;
        dispatch({
          type: "load",
          project: useStash ? { ...stashed!, version: loaded.version } : loaded,
        });
        loadedId.current = loaded.id;
        setSaveState("idle");
        if (useStash) {
          toast.info("Восстановлен несохранённый черновик из этого браузера");
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Не удалось открыть проект");
      }
    },
    [dispatch],
  );

  /* --- Сохранение ------------------------------------------------------ */

  const save = useCallback(async (): Promise<boolean> => {
    if (!state.dirty) return true;
    setSaveState("saving");
    try {
      const { project: saved } = await designApi.save(state.project);
      dispatch({ type: "saved", project: saved });
      clearStashedDraft();
      setSaveState("saved");
      setSaveError(null);
      void refreshList();
      return true;
    } catch (e) {
      setSaveState("error");
      const message = e instanceof Error ? e.message : "Сохранение не удалось";
      setSaveError(message);
      // Копия в браузере — единственное, что остаётся, если сервер отказал.
      stashDraft(state.project);
      return false;
    }
  }, [state.dirty, state.project, dispatch, refreshList]);

  useEffect(() => {
    if (!state.dirty || !allowed) return;
    setSaveState("dirty");
    const timer = setTimeout(() => void save(), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state.dirty, state.project, allowed, save]);

  // Защита от потери правок: браузер спросит подтверждение при закрытии.
  useEffect(() => {
    if (!state.dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [state.dirty]);

  /* --- Горячие клавиши ------------------------------------------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // В полях ввода клавиши принадлежат полю: Delete там стирает символ,
      // а не модуль.
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (state.selectedOpeningId) {
          e.preventDefault();
          dispatch({ type: "delete-opening", id: state.selectedOpeningId });
        } else if (state.selection.length) {
          e.preventDefault();
          dispatch({ type: "delete-modules", ids: state.selection });
        }
        return;
      }
      if (e.key === "Escape") {
        dispatch({ type: "select", ids: [] });
        setFacePick(null);
        setTool("select");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, save, state.selection, state.selectedOpeningId]);

  /* --- Операции над проектом ------------------------------------------ */

  const runAction = async (action: "publish" | "unpublish" | "archive" | "duplicate") => {
    setBusy(true);
    try {
      if (!(await save())) {
        toast.error("Сначала нужно сохранить проект");
        return;
      }
      const { project: updated, url } = await designApi.action(project.id, action);
      if (action === "duplicate") {
        await refreshList();
        await open(updated.id);
        toast.success("Создана независимая копия");
      } else {
        dispatch({ type: "saved", project: updated });
        await refreshList();
        if (action === "publish") {
          toast.success(`Опубликовано: ${url}`, {
            action: { label: "Открыть", onClick: () => window.open(url, "_blank") },
          });
        } else if (action === "unpublish") {
          toast.success("Снято с публикации. Проект остался в редакторе.");
        } else {
          toast.success("Проект отправлен в архив");
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Операция не удалась";
      toast.error(message);
      if (e instanceof ApiError && e.issues?.length) {
        for (const issue of e.issues.filter((i) => i.level === "error").slice(0, 4)) {
          toast.error(issue.message);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const createNew = async () => {
    setBusy(true);
    try {
      await save();
      const created = await designApi.create({ title: "Новый проект" });
      await refreshList();
      await open(created.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось создать проект");
    } finally {
      setBusy(false);
    }
  };

  /** Снимок текущей сцены в обложку. Хранится отдельно от JSON модели. */
  const captureCover = async () => {
    if (view !== "3d") {
      setView("3d");
      // Сцена монтируется лениво: дать ей кадр на отрисовку.
      await new Promise((r) => setTimeout(r, 800));
    }
    const canvas = viewportRef.current?.querySelector("canvas");
    if (!canvas) {
      toast.error("3D-сцена ещё не готова — попробуйте ещё раз");
      return;
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) {
      toast.error("Не удалось снять кадр");
      return;
    }
    try {
      const url = await designApi.uploadCover(project.id, blob);
      dispatch({
        type: "patch-project",
        // Хвост со временем обходит кэш браузера: без него заменённая обложка
        // осталась бы старой на экране, и человек решил бы, что снимок не сохранился.
        patch: { publication: { ...project.publication, coverImage: `${url}?v=${Date.now()}` } },
      });
      toast.success("Обложка сохранена");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Обложку сохранить не удалось");
    }
  };

  const doLogin = async () => {
    setLoggingIn(true);
    try {
      await designApi.login(secret);
      setAllowed(true);
      setSecret("");
      const projects = await refreshList();
      if (projects.length) await open(projects[0].id);
    } catch (e) {
      toast.error(
        e instanceof ApiError && e.reason === "wrong-secret"
          ? "Секрет не подошёл"
          : e instanceof Error
            ? e.message
            : "Войти не удалось",
      );
    } finally {
      setLoggingIn(false);
    }
  };

  /* --- Экраны состояния ------------------------------------------------ */

  if (!ready) {
    return (
      <div className="flex h-[70vh] items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> Загрузка режима проектирования…
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="mx-auto max-w-md py-16">
        <h2 className="text-xl font-semibold">Вход в режим проектирования</h2>
        {configured ? (
          <>
            <p className="mt-3 text-sm text-muted-foreground">
              Раздел закрыт: менять и публиковать проекты может только владелец. Секрет задан в
              окружении сервера и в браузер не передаётся.
            </p>
            <div className="mt-5 flex gap-2">
              <Input
                type="password"
                value={secret}
                autoComplete="current-password"
                placeholder="Секрет"
                onChange={(e) => setSecret(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void doLogin()}
              />
              <Button disabled={loggingIn || !secret} onClick={() => void doLogin()}>
                {loggingIn ? <Loader2 className="size-4 animate-spin" /> : "Войти"}
              </Button>
            </div>
          </>
        ) : (
          <div className="mt-3 rounded-sm bg-amber-500/10 p-4 text-sm leading-relaxed text-amber-800">
            <p className="font-medium">Режим проектирования на этом сервере не настроен.</p>
            <p className="mt-2">
              Задайте переменную окружения <code>ECOCUB_ADMIN_SECRET</code> длиной не меньше 16
              символов и перезапустите приложение. Пока её нет, изменение и публикация проектов
              закрыты для всех — включая случайного посетителя.
            </p>
          </div>
        )}
      </div>
    );
  }

  const saveLabel: Record<SaveState, string> = {
    idle: "Изменений нет",
    dirty: "Есть несохранённое",
    saving: "Сохраняется…",
    saved: "Сохранено",
    error: "Ошибка сохранения",
  };

  return (
    <div className="space-y-3">
      {devMode && (
        <p className="rounded-sm bg-amber-500/10 px-3 py-2 text-xs text-amber-800">
          Режим разработки: ECOCUB_ADMIN_SECRET не задан, правки разрешены без входа. На боевом
          сервере в этом состоянии запись была бы закрыта.
        </p>
      )}
      {!storage.writable && (
        <p className="flex items-center gap-2 rounded-sm bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <CloudOff className="size-4" />
          Хранилище недоступно ({storage.reason}). Каталог работает из файлов репозитория, но
          сохранять правки нельзя.
        </p>
      )}

      {/* Панель инструментов */}
      <div className="flex flex-wrap items-center gap-2 rounded-sm border border-border bg-card p-2">
        <div className="flex gap-1">
          {(
            [
              { id: "select", label: "Выбор", icon: MousePointer2 },
              { id: "add", label: "Модуль", icon: Grid3x3 },
              { id: "measure", label: "Линейка", icon: Ruler },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              size="sm"
              variant={tool === id ? "default" : "outline"}
              onClick={() => setTool(id)}
            >
              <Icon className="size-4" /> {label}
            </Button>
          ))}
        </div>

        <span className="mx-1 h-6 w-px bg-border" />

        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          Шаг
          <select
            value={snapStepMm}
            onChange={(e) => setSnapStepMm(Number(e.target.value))}
            className="h-8 rounded-sm border border-input bg-background px-2 text-xs"
          >
            {SNAP_STEPS.map((s) => (
              <option key={s.value} value={s.value} title={s.note}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          Этаж
          <select
            value={state.activeFloor}
            onChange={(e) => dispatch({ type: "set-floor", floor: Number(e.target.value) })}
            className="h-8 rounded-sm border border-input bg-background px-2 text-xs"
          >
            {[0, 1, 2].map((f) => (
              <option key={f} value={f}>
                {f + 1}-й
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showOtherFloors}
            onChange={(e) => setShowOtherFloors(e.target.checked)}
          />
          Другие этажи
        </label>

        <span className="mx-1 h-6 w-px bg-border" />

        <Button
          size="sm"
          variant="outline"
          disabled={!editor.canUndo}
          onClick={() => dispatch({ type: "undo" })}
        >
          <Undo2 className="size-4" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!editor.canRedo}
          onClick={() => dispatch({ type: "redo" })}
        >
          <Redo2 className="size-4" />
        </Button>

        <span className="mx-1 h-6 w-px bg-border" />

        <Button size="sm" variant="outline" onClick={() => void save()} disabled={!state.dirty}>
          <Save className="size-4" /> Сохранить
        </Button>

        <span
          className={cn(
            "flex items-center gap-1 text-xs",
            saveState === "error"
              ? "text-destructive"
              : saveState === "saved"
                ? "text-emerald-600"
                : "text-muted-foreground",
          )}
          title={saveError ?? undefined}
        >
          {saveState === "saving" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : saveState === "saved" ? (
            <Check className="size-3.5" />
          ) : null}
          {saveLabel[saveState]}
        </span>

        <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            {metrics.moduleCount} модулей · {formatArea(metrics.livingAreaM2)} · {metrics.floors}{" "}
            эт.
          </span>
          <Button
            size="sm"
            variant={view === "plan" ? "default" : "outline"}
            onClick={() => setView("plan")}
          >
            План
          </Button>
          <Button
            size="sm"
            variant={view === "3d" ? "default" : "outline"}
            onClick={() => setView("3d")}
          >
            <Box className="size-4" /> 3D
          </Button>
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)_340px]">
        {/* Список проектов */}
        <aside className="order-2 space-y-2 lg:order-1">
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              disabled={busy}
              onClick={() => void createNew()}
            >
              <FilePlus2 className="size-4" /> Новый
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                try {
                  const imported = importProjectJson(await file.text());
                  const created = await designApi.create({ project: imported });
                  await refreshList();
                  await open(created.id);
                  toast.success("Проект импортирован");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Импорт не удался");
                }
              }}
            />
            <Button
              size="sm"
              variant="outline"
              title="Импорт JSON"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="size-4" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              title="Экспорт JSON"
              onClick={() => {
                const blob = new Blob([exportProjectJson(project)], { type: "application/json" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `${project.slug}.json`;
                a.click();
                URL.revokeObjectURL(a.href);
              }}
            >
              <Download className="size-4" />
            </Button>
          </div>

          <ul className="max-h-[30vh] space-y-1 overflow-auto lg:max-h-[70vh]">
            {list.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={async () => {
                    await save();
                    await open(p.id);
                  }}
                  className={cn(
                    "w-full rounded-sm border px-2.5 py-2 text-left text-xs",
                    p.id === project.id
                      ? "border-accent bg-accent/10"
                      : "border-border hover:border-accent",
                  )}
                >
                  <span className="block font-medium">{p.title}</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {p.status === "published"
                      ? "опубликован"
                      : p.status === "archived"
                        ? "в архиве"
                        : "черновик"}{" "}
                    · {p.metrics.moduleCount} мод. · {p.metrics.floors} эт.
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Область просмотра */}
        <div ref={viewportRef} className="order-1 h-[52vh] min-h-[360px] lg:order-2 lg:h-[70vh]">
          <div className={cn("h-full", view === "plan" ? "block" : "hidden")}>
            <PlanCanvas
              editor={editor}
              tool={tool}
              snapStepMm={snapStepMm}
              showOtherFloors={showOtherFloors}
              onFacePick={(moduleId, faceId) => setFacePick({ moduleId, faceId })}
            />
          </div>
          <div
            className={cn(
              "h-full overflow-hidden rounded-sm border border-border",
              view === "3d" ? "block" : "hidden",
            )}
          >
            {view === "3d" && (
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    Загрузка 3D-сцены…
                  </div>
                }
              >
                <HouseView3D model={project.model} />
              </Suspense>
            )}
          </div>
        </div>

        {/* Панели */}
        <aside className="order-3 rounded-sm border border-border bg-card p-3">
          {facePick && (
            <div className="mb-3 rounded-sm border border-accent/50 bg-accent/5 p-2.5">
              <p className="text-xs font-medium">
                Грань {facePick.faceId} модуля {facePick.moduleId}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">Что поставить в эту грань:</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {OPENING_PRESETS.map((preset) => (
                  <Button
                    key={preset.id}
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px]"
                    title={preset.note}
                    onClick={() => {
                      dispatch({
                        type: "add-opening",
                        moduleId: facePick.moduleId,
                        faceId: facePick.faceId,
                        presetId: preset.id,
                      });
                      setFacePick(null);
                    }}
                  >
                    {preset.label}
                  </Button>
                ))}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[11px]"
                  onClick={() => setFacePick(null)}
                >
                  Отмена
                </Button>
              </div>
            </div>
          )}

          <Tabs defaultValue="inspector">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="inspector" className="text-[11px]">
                Объект
              </TabsTrigger>
              <TabsTrigger value="check" className="text-[11px]">
                Проверка
              </TabsTrigger>
              <TabsTrigger value="catalog" className="text-[11px]">
                Каталог
              </TabsTrigger>
              <TabsTrigger value="underlay" className="text-[11px]">
                Чертёж
              </TabsTrigger>
            </TabsList>

            <div className="mt-3 max-h-[56vh] overflow-auto pr-1">
              <TabsContent value="inspector">
                <Inspector editor={editor} />
              </TabsContent>
              <TabsContent value="check">
                <ValidationPanel
                  issues={issues}
                  onFocus={(targetId) => {
                    if (project.model.modules.some((m) => m.id === targetId)) {
                      dispatch({ type: "select", ids: [targetId] });
                    } else {
                      dispatch({ type: "select-opening", id: targetId });
                    }
                  }}
                />
              </TabsContent>
              <TabsContent value="catalog">
                <PublishPanel
                  editor={editor}
                  onAction={runAction}
                  onCapture={captureCover}
                  busy={busy}
                />
              </TabsContent>
              <TabsContent value="underlay">
                <UnderlayPanel editor={editor} />
              </TabsContent>
            </div>
          </Tabs>
        </aside>
      </div>
    </div>
  );
}
