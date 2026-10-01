import { useEffect, useState } from "react";
import { MessageCircle, Send } from "lucide-react";
import { site } from "@/lib/site";
import { analytics } from "@/lib/analytics";

/**
 * Плавающие кнопки Telegram и WhatsApp на всех страницах.
 *
 * Контакты — те же site.telegramHref / site.whatsappHref, что в подвале.
 * Чтобы не перекрывать формы и кнопки заявок, кнопки уходят, когда на экране
 * блок с формой (#contact, #quote, #request) или подвал: там мессенджеры и
 * так рядом. Баннера cookie на сайте нет; тосты sonner живут в правом верхнем
 * углу, модальные окна — выше по z-index (z-50), шапка — z-40.
 */
const AVOID_SELECTOR = "#contact, #quote, #request, #quick-quiz, footer";

export function StickyMessengers() {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const targets = Array.from(document.querySelectorAll(AVOID_SELECTOR));
    if (!targets.length || typeof IntersectionObserver === "undefined") return;
    const visible = new Set<Element>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target);
          else visible.delete(e.target);
        }
        setHidden(visible.size > 0);
      },
      // Срабатываем, когда блок занял нижнюю часть экрана, где стоят кнопки.
      { rootMargin: "0px 0px -15% 0px" },
    );
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, []);

  const btn =
    "flex size-12 items-center justify-center rounded-full text-white shadow-[0_8px_24px_-6px_rgba(0,0,0,0.45)] transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 md:size-14";

  return (
    <div
      className={[
        "fixed right-3 z-30 flex flex-col gap-2.5 transition-all duration-300 md:right-6",
        "bottom-[calc(0.75rem+env(safe-area-inset-bottom))] md:bottom-6",
        hidden ? "pointer-events-none translate-y-4 opacity-0" : "opacity-100",
      ].join(" ")}
      aria-hidden={hidden}
    >
      <a
        href={site.telegramHref}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Написать в Telegram"
        title="Написать в Telegram"
        tabIndex={hidden ? -1 : 0}
        onClick={() => analytics.contactClick("telegram", "sticky")}
        className={`${btn} bg-[#229ED9]`}
      >
        <Send className="size-5 -translate-x-px translate-y-px md:size-6" />
      </a>
      <a
        href={site.whatsappHref}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Написать в WhatsApp"
        title="Написать в WhatsApp"
        tabIndex={hidden ? -1 : 0}
        onClick={() => analytics.contactClick("whatsapp", "sticky")}
        className={`${btn} bg-[#25D366]`}
      >
        <MessageCircle className="size-5 md:size-6" />
      </a>
    </div>
  );
}
