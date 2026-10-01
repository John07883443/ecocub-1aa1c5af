import { useEffect, useRef } from "react";
import { HONEYPOT_FIELD } from "@/lib/antispam";

/**
 * Клиентская половина антиспама (серверная — в api.lead.tsx, правила —
 * в lib/antispam.ts). Подключается к любой форме, которая шлёт /api/lead:
 *
 *   const spam = useAntiSpam();
 *   …<HoneypotField inputRef={spam.honeypotRef} />…
 *   body: JSON.stringify({ ...lead, ...spam.fields() })
 */
export function useAntiSpam() {
  const honeypotRef = useRef<HTMLInputElement>(null);
  const shownAt = useRef<number | null>(null);

  useEffect(() => {
    shownAt.current = Date.now();
  }, []);

  const fields = () => ({
    [HONEYPOT_FIELD]: honeypotRef.current?.value ?? "",
    elapsedMs: shownAt.current == null ? undefined : Date.now() - shownAt.current,
  });

  return { honeypotRef, fields };
}

/**
 * Поле-ловушка. Не display:none — часть ботов такие поля пропускает; вместо
 * этого вынесено за экран и скрыто от клавиатуры и скринридеров.
 */
export function HoneypotField({
  inputRef,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        left: "-10000px",
        top: "auto",
        width: 1,
        height: 1,
        overflow: "hidden",
      }}
    >
      <label>
        Сайт
        <input
          ref={inputRef}
          type="text"
          name={HONEYPOT_FIELD}
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
        />
      </label>
    </div>
  );
}
