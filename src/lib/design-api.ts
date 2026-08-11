import { parseProject, serializeProject } from "./house-project/serialize";
import type { HouseProject, ProjectSummary, ValidationIssue } from "./house-project/types";

/**
 * Клиент административного API. Только браузер.
 *
 * Тонкая обёртка вокруг fetch: единственное, что она добавляет, — разбор
 * ответа в понятную ошибку. Без этого каждый обработчик в редакторе повторял
 * бы одну и ту же проверку `res.ok`, и однажды кто-нибудь её забыл бы —
 * человек увидел бы «Сохранено» на неудавшемся сохранении.
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    public reason: string,
    message: string,
    public issues?: ValidationIssue[],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // Пустое тело — нормально для ответов без содержимого.
  }
  if (!res.ok || body.ok === false) {
    throw new ApiError(
      res.status,
      String(body.reason ?? "unknown"),
      String(body.message ?? `Сервер ответил ${res.status}`),
      body.issues as ValidationIssue[] | undefined,
    );
  }
  return body as T;
}

export interface SessionState {
  /** Пароль задан хоть каким-то способом. */
  configured: boolean;
  /** Место владельца занято: форму «придумайте пароль» показывать нельзя. */
  claimed: boolean;
  /** Пароль задан переменной окружения сервера, а не из браузера. */
  envSecret: boolean;
  /** На сервере настроен вход через Google — можно показывать кнопку. */
  google: boolean;
  /** Пароль ещё можно задать: место не занято ни паролем, ни переменной. */
  passwordClaimAvailable: boolean;
  minPasswordLength: number;
  production: boolean;
  allowed: boolean;
  mode: "session" | "dev" | null;
}

export const designApi = {
  session: () => call<SessionState>("/api/design/session"),

  login: (password: string) =>
    call<{ ok: true }>("/api/design/session", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),

  /** Задать пароль первый раз. Работает, только пока место свободно. */
  claim: (password: string) =>
    call<{ ok: true; claimed: true }>("/api/design/session", {
      method: "POST",
      body: JSON.stringify({ claim: password }),
    }),

  logout: () => call<{ ok: true }>("/api/design/session", { method: "DELETE" }),

  list: () =>
    call<{ projects: ProjectSummary[]; storage: { writable: boolean; reason?: string } }>(
      "/api/design/projects",
    ),

  get: async (id: string) => {
    const body = await call<{ project: unknown; issues: ValidationIssue[] }>(
      `/api/design/projects/${encodeURIComponent(id)}`,
    );
    const project = parseProject(body.project);
    if (!project)
      throw new ApiError(500, "unreadable", "Сервер вернул проект, который не читается");
    return { project, issues: body.issues };
  },

  create: async (input: { title?: string; project?: HouseProject }) => {
    const body = await call<{ project: unknown }>("/api/design/projects", {
      method: "POST",
      body: JSON.stringify(
        input.project ? { project: serializeProject(input.project) } : { title: input.title },
      ),
    });
    const project = parseProject(body.project);
    if (!project) throw new ApiError(500, "unreadable", "Созданный проект не читается");
    return project;
  },

  save: async (project: HouseProject) => {
    const body = await call<{ project: unknown; issues: ValidationIssue[] }>(
      `/api/design/projects/${encodeURIComponent(project.id)}`,
      {
        method: "PUT",
        body: JSON.stringify({
          project: serializeProject(project),
          expectedVersion: project.version,
        }),
      },
    );
    const saved = parseProject(body.project);
    if (!saved) throw new ApiError(500, "unreadable", "Сохранённый проект не читается");
    return { project: saved, issues: body.issues };
  },

  action: async (id: string, action: "publish" | "unpublish" | "archive" | "duplicate") => {
    const body = await call<{ project: unknown; url?: string }>(
      `/api/design/projects/${encodeURIComponent(id)}`,
      { method: "POST", body: JSON.stringify({ action }) },
    );
    const project = parseProject(body.project);
    if (!project) throw new ApiError(500, "unreadable", "Ответ сервера не читается");
    return { project, url: body.url };
  },

  /** Удалить безвозвратно. Подтверждение спрашивает интерфейс, не этот слой. */
  remove: (id: string) =>
    call<{ ok: true }>(`/api/design/projects/${encodeURIComponent(id)}`, { method: "DELETE" }),

  uploadCover: async (id: string, blob: Blob) => {
    const res = await fetch(`/api/design/cover/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": blob.type || "image/png" },
      body: blob,
    });
    const body = (await res.json()) as { ok?: boolean; url?: string; message?: string };
    if (!res.ok || !body.url) {
      throw new ApiError(res.status, "cover", body.message ?? "Не удалось сохранить обложку");
    }
    return body.url;
  },
};

/**
 * Аварийная копия черновика в браузере.
 *
 * Не хранилище: опубликованные проекты живут только на сервере. Это страховка
 * от закрытой вкладки и упавшего интернета — если при следующем открытии
 * копия окажется свежее серверной, редактор предложит её восстановить.
 */
const DRAFT_KEY = "ecocub-design-draft";

export function stashDraft(project: HouseProject): void {
  try {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ at: Date.now(), project: serializeProject(project) }),
    );
  } catch {
    // Приватный режим и переполненное хранилище — не повод ронять редактор.
  }
}

export function takeStashedDraft(id: string): HouseProject | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { project?: unknown };
    const project = parseProject(parsed.project);
    return project && project.id === id ? project : null;
  } catch {
    return null;
  }
}

export function clearStashedDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* пусто */
  }
}
