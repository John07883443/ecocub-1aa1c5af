import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Box,
  Trash2,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { formatArea, plural } from "@/lib/house-projects";
import { cn } from "@/lib/utils";
import { Inspector } from "./Inspector";
import { PlanCanvas, type Tool } from "./PlanCanvas";
import { PublishPanel } from "./PublishPanel";
import { UnderlayPanel } from "./UnderlayPanel";
import { ValidationPanel } from "./ValidationPanel";

const HouseView3D = lazy(() => import("./HouseView3D"));

/**
 * Список ракурсов дублируется здесь, а не импортируется из HouseView3D.
 *
 * Сцена грузится лениво отдельным чанком; импорт из неё ради шести подписей
 * притащил бы three.js в основной бандл — то есть ровно то, от чего ленивая
 * загрузка избавляет.
 */
const CAMERA_VIEWS = [
  { id: "free", label: "Свободно" },
  { id: "top", label: "Сверху" },
  { id: "north", label: "Фасад +Y" },
  { id: "east", label: "Фасад +X" },
  { id: "south", label: "Фасад −Y" },
  { id: "west", label: "Фасад −X" },
] as const;

type CameraView = (typeof CAMERA_VIEWS)[number]["id"];

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

/**
 * Фирменный знак Google.
 *
 * Нарисован разметкой, а не картинкой: правила Google требуют показывать знак
 * без искажений и перекраски, а свой SVG это гарантирует и не добавляет
 * лишнего запроса к серверу за файлом.
 */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.7 30.1 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.2 17.7 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.1 24.6c0-1.6-.1-3.2-.4-4.6H24v9.1h12.4c-.5 2.9-2.1 5.3-4.6 6.9l7.2 5.6c4.2-3.9 6.6-9.6 6.6-16.4z"
      />
      <path
        fill="#FBBC05"
        d="M10.4 28.7c-.5-1.4-.8-2.9-.8-4.5s.3-3.1.8-4.5l-7.8-6.1C1 16.8 0 20.3 0 24s1 7.2 2.6 10.4l7.8-5.7z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.2-5.6c-2.1 1.4-4.8 2.3-8.7 2.3-6.3 0-11.7-3.7-13.6-9.1l-7.8 5.7C6.5 42.6 14.6 48 24 48z"
      />
    </svg>
  );
}

export function DesignStudio() {
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [claimed, setClaimed] = useState(true);
  const [googleReady, setGoogleReady] = useState(false);
  const [passwordAvailable, setPasswordAvailable] = useState(true);
  const [minLength, setMinLength] = useState(8);
  const [devMode, setDevMode] = useState(false);
  const [secret, setSecret] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  const [list, setList] = useState<ProjectSummary[]>([]);
  const [storage, setStorage] = useState<{ writable: boolean; reason?: string }>({
    writable: true,
  });
  const [busy, setBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  /** Проект, для которого открыт вопрос «удалить безвозвратно?». */
  const [pendingDelete, setPendingDelete] = useState<ProjectSummary | null>(null);

  const editor = useDesignEditor(useMemo(() => createProject("Загрузка…"), []));
  const { state, dispatch } = editor;
  const project = state.project;

  const [tool, setTool] = useState<Tool>("select");
  const [snapStepMm, setSnapStepMm] = useState(SNAP_STEPS[0].value);
  const [showOtherFloors, setShowOtherFloors] = useState(true);
  const [view, setView] = useState<"plan" | "3d">("plan");
  const [cameraView, setCameraView] = useState<CameraView>("free");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [facePick, setFacePick] = useState<{ moduleId: string; faceId: FaceId } | null>(null);

  const viewportRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const loadedId = useRef<string | null>(null);

  // Архив по умолчанию не показывается: убранный проект должен исчезать из
  // списка, иначе архивирование ничего не решает и список только растёт.
  // Открытый сейчас проект показывается всегда — иначе он пропал бы из-под
  // курсора в тот момент, когда его архивируют.
  const archivedCount = useMemo(() => list.filter((p) => p.status === "archived").length, [list]);
  const visibleList = useMemo(
    () => list.filter((p) => showArchived || p.status !== "archived" || p.id === project.id),
    [list, showArchived, project.id],
  );

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

  // Возврат из Google приносит исход параметром адреса. Показываем его
  // человеческой строкой и убираем параметр, чтобы он не висел в ссылке.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("oauth");
    if (!outcome) return;
    const messages: Record<string, string> = {
      claimed: "Готово: этот аккаунт Google теперь владелец раздела",
      cancelled: "Вход отменён",
      "not-allowed": "Этот аккаунт Google не имеет доступа к разделу",
      unverified: "Почта в этом аккаунте Google не подтверждена",
      "bad-state": "Вход не завершён: попробуйте ещё раз с этой же вкладки",
      "exchange-failed": "Google не подтвердил вход. Проверьте ключи на сервере",
      "not-configured": "Вход через Google на сервере не настроен",
      storage: "Хранилище недоступно, вход сохранить не удалось",
    };
    const text = messages[outcome] ?? "Вход через Google не удался";
    if (outcome === "claimed") toast.success(text);
    else toast.error(text);
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await designApi.session();
        if (cancelled) return;
        setClaimed(session.claimed);
        setGoogleReady(session.google);
        setPasswordAvailable(session.passwordClaimAvailable);
        setMinLength(session.minPasswordLength);
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

  /**
   * Убрать проект из списка, не открывая его.
   *
   * Безвозвратного удаления в системе нет намеренно: в проекте лежит
   * геометрия, снятая с чертежей, и стереть её одним нажатием слишком легко.
   * Архив решает ту же задачу — из списка и из каталога проект пропадает, —
   * но остаётся обратимым.
   */
  const archiveFromList = async (id: string) => {
    setBusy(true);
    try {
      if (id === project.id) await save();
      await designApi.action(id, "archive");
      const projects = await refreshList();
      // Если убрали открытый проект, показываем следующий живой, чтобы
      // редактор не остался с архивной записью на экране.
      if (id === project.id) {
        const next = projects.find((p) => p.status !== "archived");
        if (next) await open(next.id);
      }
      toast.success("Проект убран в архив");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось убрать в архив");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Удалить безвозвратно.
   *
   * Спрашивается подтверждение с названием проекта: «Вы уверены?» без имени
   * человек подтверждает не глядя, а тут стирается геометрия, снятая с
   * чертежей. Рядом в том же окне предложен архив — обратимый вариант для
   * тех, кто нажал корзину по инерции.
   */
  const deleteProject = async (summary: ProjectSummary) => {
    setBusy(true);
    try {
      await designApi.remove(summary.id);
      const projects = await refreshList();
      if (summary.id === project.id) {
        const next = projects.find((p) => p.status !== "archived") ?? projects[0];
        if (next) await open(next.id);
        else dispatch({ type: "load", project: createProject("Новый проект") });
      }
      toast.success(`Проект «${summary.title}» удалён`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Удалить не удалось");
    } finally {
      setBusy(false);
      setPendingDelete(null);
    }
  };

  /** Вернуть из архива: архив на то и архив, что из него достают. */
  const restoreFromList = async (id: string) => {
    setBusy(true);
    try {
      await designApi.action(id, "unpublish");
      await refreshList();
      toast.success("Проект возвращён в черновики");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось вернуть из архива");
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

  const doLogin = async (claiming = false) => {
    setLoggingIn(true);
    try {
      if (claiming) {
        await designApi.claim(secret);
        setClaimed(true);
        toast.success("Пароль задан. Запишите его — восстановить нельзя.");
      } else {
        await designApi.login(secret);
      }
      setAllowed(true);
      setSecret("");
      const projects = await refreshList();
      if (projects.length) await open(projects[0].id);
    } catch (e) {
      if (e instanceof ApiError && e.reason === "already-claimed") {
        // Кто-то занял место, пока страница была открыта: показываем обычный вход.
        setClaimed(true);
        toast.error(e.message);
      } else {
        toast.error(
          e instanceof ApiError && e.reason === "wrong-password"
            ? "Пароль не подошёл"
            : e instanceof Error
              ? e.message
              : "Войти не удалось",
        );
      }
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
    // Пароля ещё нет — предлагаем придумать его прямо здесь. Отправлять
    // человека в SSH на сервер за переменной окружения значит не пустить его
    // в раздел вовсе: владелец продукта работает с телефона.
    const claiming = !claimed;
    // Пароль показываем, пока им ещё можно воспользоваться: если владелец
    // вошёл через Google, форма пароля превратилась бы в тупик.
    const showPassword = passwordAvailable || !claiming;
    return (
      <div className="mx-auto max-w-md py-16">
        <h2 className="text-xl font-semibold">
          {claiming ? "Вход в режим проектирования" : "Вход в режим проектирования"}
        </h2>
        <p className="mt-3 text-sm text-muted-foreground">
          {claiming
            ? "Раздел ещё никем не занят. Войдите через Google — этот аккаунт станет владельцем, и все функции откроются."
            : "Раздел закрыт: менять и публиковать проекты может только владелец."}
        </p>

        {googleReady && (
          <>
            <a
              href="/api/design/oauth/start"
              className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-sm border border-border bg-background text-sm font-medium transition-colors hover:border-accent"
            >
              <GoogleMark />
              Войти через Google
            </a>
            {showPassword && (
              <p className="my-4 text-center text-xs uppercase tracking-wide text-muted-foreground">
                или паролем
              </p>
            )}
          </>
        )}

        {!showPassword && !googleReady && (
          <p className="mt-5 rounded-sm bg-amber-500/10 p-3 text-sm text-amber-800">
            Владелец входит через Google, но вход через Google на сервере сейчас не настроен.
            Задайте GOOGLE_OAUTH_CLIENT_ID и GOOGLE_OAUTH_CLIENT_SECRET либо запасной пароль в
            ECOCUB_ADMIN_SECRET.
          </p>
        )}

        {showPassword && (
          <>
            <p className="mt-3 text-sm text-muted-foreground">
              {claiming
                ? `Пароль задаётся один раз, не короче ${minLength} символов. Хранится хешем, восстановить нельзя — запишите.`
                : "Пароль хранится на сервере хешем и в браузер не передаётся."}
            </p>
            <div className="mt-5 flex gap-2">
              <Input
                type="password"
                value={secret}
                autoComplete={claiming ? "new-password" : "current-password"}
                placeholder={claiming ? "Новый пароль" : "Пароль"}
                onChange={(e) => setSecret(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void doLogin(claiming)}
              />
              <Button
                disabled={loggingIn || secret.length < (claiming ? minLength : 1)}
                onClick={() => void doLogin(claiming)}
              >
                {loggingIn ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : claiming ? (
                  "Задать"
                ) : (
                  "Войти"
                )}
              </Button>
            </div>
          </>
        )}
        {claiming && (
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            Пока владелец не назначен, занять место может любой, кто откроет эту страницу. Сделайте
            это сейчас — второй раз место не занять. Запасной вход задаётся переменной{" "}
            <code>ECOCUB_ADMIN_SECRET</code> на сервере: она перебивает и пароль, и Google.
          </p>
        )}
        {!storage.writable && (
          <p className="mt-4 rounded-sm bg-destructive/10 p-3 text-xs text-destructive">
            Хранилище на сервере недоступно, пароль сохранить некуда. Проверьте переменную
            HOUSE_PROJECTS_DB_PATH и права на каталог.
          </p>
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
          Режим разработки: пароль не задан, правки разрешены без входа. На боевом сервере в этом
          состоянии запись была бы закрыта.
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

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить «{pendingDelete?.title}» безвозвратно?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Модель дома и обложка будут стёрты с сервера. Отменить это будет нельзя, и в
                  истории отмены проект тоже не восстановится.
                </p>
                {pendingDelete?.status === "published" && (
                  <p className="font-medium text-destructive">
                    Проект сейчас опубликован — страница в каталоге домов перестанет открываться, а
                    ссылки на неё дадут «не найдено».
                  </p>
                )}
                <p className="text-muted-foreground">
                  Если нужно просто убрать его из списка — закройте это окно и нажмите соседнюю
                  кнопку «в архив»: оттуда проект можно вернуть.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => pendingDelete && void deleteProject(pendingDelete)}
            >
              Удалить безвозвратно
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
            {visibleList.map((p) => (
              <li key={p.id} className="group relative">
                <button
                  type="button"
                  onClick={async () => {
                    await save();
                    await open(p.id);
                  }}
                  className={cn(
                    "w-full rounded-sm border py-2 pl-2.5 pr-8 text-left text-xs",
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

                {/*
                  Убрать из списка прямо здесь, а не через вкладку каталога.
                  Пробный проект создаётся одним нажатием — значит и убираться
                  должен одним, иначе список зарастает «Новыми проектами».
                */}
                <span className="absolute right-1 top-1.5 flex gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  {p.status !== "archived" ? (
                    <button
                      type="button"
                      title="Убрать в архив — обратимо"
                      aria-label={`Убрать «${p.title}» в архив`}
                      onClick={() => void archiveFromList(p.id)}
                      className="rounded-sm p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                    >
                      <Archive className="size-3.5" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      title="Вернуть из архива в черновики"
                      aria-label={`Вернуть «${p.title}» из архива`}
                      onClick={() => void restoreFromList(p.id)}
                      className="rounded-sm p-1 text-muted-foreground hover:bg-secondary hover:text-accent"
                    >
                      <Undo2 className="size-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    title="Удалить безвозвратно"
                    aria-label={`Удалить «${p.title}»`}
                    onClick={() => setPendingDelete(p)}
                    className="rounded-sm p-1 text-muted-foreground hover:bg-secondary hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </span>
              </li>
            ))}
          </ul>

          {archivedCount > 0 && (
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              className="w-full px-1 text-left text-[11px] text-muted-foreground hover:text-accent"
            >
              {showArchived ? "скрыть архив" : `показать архив (${archivedCount})`}
            </button>
          )}
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
              "relative h-full overflow-hidden rounded-sm border border-border",
              view === "3d" ? "block" : "hidden",
            )}
          >
            {view === "3d" && (
              <>
                <Suspense
                  fallback={
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      Загрузка 3D-сцены…
                    </div>
                  }
                >
                  <HouseView3D model={project.model} cameraView={cameraView} />
                </Suspense>
                <div className="absolute left-2 top-2 flex flex-wrap gap-1">
                  {CAMERA_VIEWS.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setCameraView(v.id)}
                      className={cn(
                        "rounded-sm border px-2 py-1 text-[11px] shadow-sm",
                        cameraView === v.id
                          ? "border-accent bg-accent/15 text-accent"
                          : "border-border bg-background/90 hover:border-accent",
                      )}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              </>
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
