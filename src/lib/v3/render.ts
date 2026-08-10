/**
 * AI-рендер фасада: абстракция провайдера.
 *
 * Факты среды (проверено при аудите): у боевого сайта нет runtime-API для
 * генерации изображений — Higgsfield доступен только как MCP-инструмент
 * агента разработки, из браузера или Node-сервера сайта его вызвать нельзя,
 * а секретных ключей генерации в переменных окружения продакшена нет.
 *
 * Поэтому активный провайдер — ManualMcpRenderProvider: сайт готовит точное
 * задание (RenderRequest с неизменяемыми признаками конфигурации), сохраняет
 * его в проекте и отдаёт менеджеру вместе с лидом; генерация запускается
 * вручную через Claude/MCP, готовый рендер уходит клиенту в Telegram.
 * Никаких ключей в клиентском коде; никакой имитации "живой" генерации.
 *
 * Когда появится серверный API-доступ, сюда добавляется третья реализация
 * RenderProvider с очередью на сервере — интерфейс менять не придётся.
 */

import type { ModuleItem } from "../constructor/types.ts";
import type { DesignPreset } from "../constructor/types.ts";
import type { RenderJob, RenderProvider, RenderRequest } from "./types.ts";

export type RenderMood = {
  lighting: "day" | "evening";
  season: "summer" | "winter";
  environment: string;
};

export const ENVIRONMENTS = [
  "Лесной участок",
  "Минималистичный ландшафт",
  "Семейный двор с газоном",
  "Премиальный ландшафтный дизайн",
] as const;

/** Собрать точное задание на рендер из конфигурации проекта. */
export function buildRenderRequest(
  projectId: string,
  modules: ModuleItem[],
  design: DesignPreset,
  mood: RenderMood,
): RenderRequest {
  const floors = modules.length ? Math.max(...modules.map((m) => m.floor)) + 1 : 0;
  const footprint = modules
    .filter((m) => m.floor === 0)
    .map((m) => `${m.x},${m.z}`)
    .sort();

  const prompt = [
    `Фотореалистичный рендер модульного бетонного дома EcoCub (модули 3×3 м, высота этажа 3,15 м, плоская кровля).`,
    `Конфигурация неизменяема: ${floors} этаж(а), ${modules.length} модулей, силуэт первого этажа по списку ячеек — архитектуру не менять.`,
    `Фасад: ${design.name} (стены ${design.wall}, кровля ${design.roof}, остекление ${design.glass}).`,
    `Свет: ${mood.lighting === "day" ? "дневной" : "вечерний, тёплые окна"}. Сезон: ${
      mood.season === "summer" ? "лето" : "зима"
    }. Окружение: ${mood.environment}.`,
  ].join(" ");

  return {
    projectId,
    invariants: { floors, moduleCount: modules.length, footprint },
    facade: {
      presetId: design.id,
      presetName: design.name,
      lighting: mood.lighting,
      season: mood.season,
      environment: mood.environment,
    },
    prompt,
  };
}

/** Базовая проверка результата: этажность и число объёмов совпадают с заданием. */
export function verifyRenderResult(
  request: RenderRequest,
  observed: { floors: number; moduleCount: number },
): boolean {
  return (
    observed.floors === request.invariants.floors &&
    Math.abs(observed.moduleCount - request.invariants.moduleCount) <=
      Math.ceil(request.invariants.moduleCount * 0.2)
  );
}

let jobCounter = 0;
const newJobId = () => `job-${Date.now().toString(36)}-${++jobCounter}`;

/**
 * Внутренний режим: задание готовится на сайте, генерация запускается
 * менеджером через Claude/MCP. Job сразу в состоянии 'manual'.
 */
export class ManualMcpRenderProvider implements RenderProvider {
  readonly id = "manual-mcp";
  readonly modeNote =
    "Рендер готовит специалист EcoCub по точному заданию конфигуратора и присылает вместе с расчётом — обычно в течение рабочего дня.";

  private jobs = new Map<string, RenderJob>();

  async createRender(input: RenderRequest): Promise<RenderJob> {
    const job: RenderJob = {
      jobId: newJobId(),
      state: "manual",
      manualTask: input,
      note: this.modeNote,
    };
    this.jobs.set(job.jobId, job);
    return job;
  }

  async getRenderStatus(jobId: string): Promise<RenderJob> {
    return this.jobs.get(jobId) ?? { jobId, state: "manual", note: this.modeNote };
  }
}

/** Отладочный провайдер для интерфейса: мгновенно «завершает» задачу превью пресета. */
export class MockRenderProvider implements RenderProvider {
  readonly id = "mock";
  readonly modeNote = "Демо-режим: вместо генерации показывается готовое превью фасада.";

  private previewByPreset: Record<string, string | undefined>;

  constructor(previewByPreset: Record<string, string | undefined> = {}) {
    this.previewByPreset = previewByPreset;
  }

  async createRender(input: RenderRequest): Promise<RenderJob> {
    return {
      jobId: newJobId(),
      state: "done",
      resultUrl: this.previewByPreset[input.facade.presetId],
      note: this.modeNote,
    };
  }

  async getRenderStatus(jobId: string): Promise<RenderJob> {
    return { jobId, state: "done", note: this.modeNote };
  }
}

/** Активный провайдер новой версии. Меняется здесь — один флаг на весь код. */
export function activeRenderProvider(): RenderProvider {
  return new ManualMcpRenderProvider();
}
