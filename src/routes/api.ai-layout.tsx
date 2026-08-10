import { createFileRoute } from "@tanstack/react-router";

import { availability, publicConfig, readConfig } from "@/lib/ai-layout/config";
import { buildFootprint } from "@/lib/ai-layout/footprint";
import { describeNudges, relaxJoints } from "@/lib/ai-layout/relax";
import { buildLayoutPrompt, clampProgram, PROMPT_VERSION } from "@/lib/ai-layout/prompt";
import { createProvider, type LayoutResult } from "@/lib/ai-layout/provider";
import {
  clientIp,
  findJob,
  jobKey,
  saveJob,
  spentToday,
  visitorHash,
  visitorSpent,
  type JobRecord,
} from "@/lib/ai-layout/quota.server";
import { canonicalKeySource, normalizeRequest } from "@/lib/ai-layout/request";
import { saveImage } from "@/lib/ai-layout/store.server";

/**
 * /api/ai-layout — генерация эскизной планировки по собранному дому.
 *
 * Единственная точка, где живут ключи провайдера: из браузера к платному API
 * не ходит ничего. Промпт собирается здесь же из проверенных полей — с фронта
 * приходит только геометрия и число комнат, свободного текста нет.
 *
 * Порядок проверок обязателен именно такой: доступность → разбор запроса →
 * идемпотентность → лимиты → и только потом обращение к провайдеру. Место в
 * счётчике занимается ДО оплаченного вызова, иначе два одновременных запроса
 * пролезут мимо лимита и оба спишут деньги.
 */

/** Что отдаём наружу. Внутренних полей записи (visitor, payload) здесь нет. */
function present(job: JobRecord) {
  return {
    ok: true as const,
    key: job.key,
    status: job.status,
    imageUrl: job.imageUrl,
    // Заглушку интерфейс обязан подписать как заглушку.
    isMock: job.isMock,
    reason: job.reason,
  };
}

function applyResult(job: JobRecord, result: LayoutResult): JobRecord {
  switch (result.status) {
    case "completed":
      return { ...job, status: "completed", imageUrl: result.imageUrl, isMock: !!result.isMock };
    case "pending":
      return { ...job, status: "pending", externalId: result.externalId };
    case "queued_manual":
      return { ...job, status: "queued_manual" };
    case "failed":
      return { ...job, status: "failed", reason: result.reason };
  }
}

export const Route = createFileRoute("/api/ai-layout")({
  server: {
    handlers: {
      /** Состояние функции и текущей генерации. Денег не тратит. */
      GET: async ({ request }) => {
        const config = readConfig();
        const url = new URL(request.url);
        const key = url.searchParams.get("key");

        if (!key) return Response.json({ ok: true, config: publicConfig(config) });

        const job = await findJob(key);
        if (!job) return Response.json({ ok: false, reason: "not_found" }, { status: 404 });

        // Асинхронного провайдера опрашиваем лениво — по запросу из браузера,
        // без фоновых таймеров на сервере.
        if (job.status === "pending" && job.externalId) {
          const provider = createProvider(config);
          if (provider.poll) {
            const updated = applyResult(job, await provider.poll(job.externalId));
            await saveJob(updated);
            return Response.json(present(updated));
          }
        }
        return Response.json(present(job));
      },

      POST: async ({ request }) => {
        const config = readConfig();
        const state = availability(config);
        if (!state.ok) {
          return Response.json({ ok: false, reason: state.reason }, { status: 503 });
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, reason: "bad_json" }, { status: 400 });
        }

        const normalized = normalizeRequest(body);
        if (!normalized.ok) {
          return Response.json({ ok: false, reason: normalized.reason }, { status: 400 });
        }

        // Тесные стыки разжимаются ДО построения контура. Человек волен
        // сдвинуть кубик так, что между двумя модулями останется метр стыка,
        // а дверь 800 мм туда физически не встаёт — модель в такой геометрии
        // либо нарисует дверь сквозь стену, либо оставит комнату без входа.
        // Правит геометрия, а не модель: контур перерисовывается уже
        // исправленным, и накладка поверх результата снова совпадает с ним.
        const relaxed = relaxJoints(normalized.value.modules);
        const modules = relaxed.modules;

        const footprint = buildFootprint(modules);
        if (!footprint.modules.length) {
          return Response.json({ ok: false, reason: "empty_footprint" }, { status: 400 });
        }
        const program = clampProgram(normalized.value.program, footprint);

        const visitor = visitorHash(clientIp(request.headers), config.visitorSecret!);
        const key = jobKey(
          canonicalKeySource({ modules, program }, config.model, PROMPT_VERSION),
          visitor,
        );

        // Повтор того же запроса возвращает прежний результат и не платит
        // второй раз. Неудачную попытку повторить можно — она не в счёт.
        const existing = await findJob(key);
        if (existing && existing.status !== "failed") {
          return Response.json({ ...present(existing), notice: describeNudges(relaxed.nudges) });
        }

        if ((await visitorSpent(visitor)) >= config.freePerVisitor) {
          return Response.json({ ok: false, reason: "limit_visitor" }, { status: 429 });
        }
        if ((await spentToday()) >= config.dailyLimit) {
          return Response.json({ ok: false, reason: "limit_daily" }, { status: 429 });
        }

        const reserved: JobRecord = {
          key,
          visitor,
          status: "pending",
          provider: config.provider,
          imageUrl: null,
          externalId: null,
          isMock: config.provider === "mock",
          reason: null,
          createdAt: new Date().toISOString(),
          payload: JSON.stringify({ modules, program }),
        };
        await saveJob(reserved);

        const provider = createProvider(config);
        const result = await provider.start({
          footprintUrl: `${config.publicBase}/api/ai-layout/footprint?key=${key}`,
          prompt: buildLayoutPrompt(footprint, program),
          key,
          // Провайдер, возвращающий байты, кладёт картинку к нам: чужая
          // ссылка однажды протухнет, а планировка должна открываться и потом.
          store: saveImage,
        });

        // Настоящая цена запроса приходит в ответе — записываем её в лог,
        // иначе расход виден только в чужом кабинете и задним числом.
        if (result.status === "completed" && result.costUsd !== undefined) {
          console.info(`AI-планировка: генерация выполнена, стоимость $${result.costUsd}`);
        }

        const updated = applyResult(reserved, result);
        await saveJob(updated);
        // Если геометрию пришлось поправить — человек должен об этом узнать,
        // а не гадать, почему дом на картинке чуть отличается от собранного.
        return Response.json({ ...present(updated), notice: describeNudges(relaxed.nudges) });
      },
    },
  },
});
