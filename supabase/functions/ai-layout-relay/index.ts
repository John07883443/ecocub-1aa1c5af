/**
 * Ретранслятор запросов на генерацию планировки.
 *
 * Зачем он вообще нужен. Боевой сервер сайта стоит в России, и американские
 * AI-сервисы его не пускают: запрос к OpenRouter отбивается защитой Cloudflare
 * с ответом «Access denied by security policy» ещё на границе, до самого API.
 * Проверено 10.08.2026 с сервера: Telegram и Higgsfield с него ходят, а
 * openrouter.ai отвечает 403 даже на публичный список моделей, где ключ не
 * нужен вовсе. Значит дело в адресе отправителя, а не в авторизации.
 *
 * Эта функция выполняется на инфраструктуре Supabase за пределами России и
 * служит единственной дверью наружу: принимает запрос от нашего сервера и
 * переправляет его в OpenRouter уже со своего адреса.
 *
 * Что здесь НЕ проходит: ни имени, ни телефона, ни адреса посетителя. Только
 * текст промпта, собранный из геометрии дома, и публичная ссылка на
 * чёрно-белый контур. Персональные данные по-прежнему живут исключительно на
 * сервере в России — правило проекта этим не нарушается.
 */

/** Единственный адрес, куда ретранслятор умеет ходить. */
const TARGET = "https://openrouter.ai/api/v1/images";

/**
 * Потолок на размер запроса. Промпт и ссылка занимают единицы килобайт;
 * всё, что заметно больше, — либо ошибка, либо попытка прогнать через нас
 * что-то постороннее.
 */
const MAX_BODY = 64 * 1024;

/**
 * Сравнение секретов за одинаковое время. Обычное сравнение строк выходит из
 * цикла на первом различии, и по разнице во времени ответа секрет можно
 * подобрать посимвольно.
 */
function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const expected = Deno.env.get("RELAY_SECRET");
  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!expected || !apiKey) return json(500, { error: "relay_not_configured" });

  // Без общего секрета это был бы открытый прокси: любой желающий генерировал
  // бы картинки за счёт владельца ключа.
  const given = req.headers.get("x-relay-secret") ?? "";
  if (!secretsMatch(given, expected)) return json(401, { error: "unauthorized" });

  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(413, { error: "body_too_large" });

  try {
    // Тело пересылается как есть: что отправлять, решает наш сервер, а
    // ретранслятор ничего не додумывает. Адрес назначения при этом зашит —
    // через эту дверь нельзя обратиться никуда, кроме OpenRouter.
    const upstream = await fetch(TARGET, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": Deno.env.get("RELAY_REFERER") ?? "https://eco-cub.ru",
        "X-Title": "EcoCub AI layout",
      },
      body: raw,
    });

    // Ответ отдаём без разбора, включая код ошибки: диагностикой занимается
    // вызывающая сторона, и ей нужен подлинный ответ, а не наш пересказ.
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return json(502, { error: "upstream_unreachable", detail: String(e) });
  }
});
