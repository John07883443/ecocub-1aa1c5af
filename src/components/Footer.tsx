import { Link } from "@tanstack/react-router";
import { Mail, Phone, MapPin } from "lucide-react";
import { useRef } from "react";
import { Container } from "@/components/Container";
import { Reveal } from "@/components/motion/Reveal";
import { mainNav, site } from "@/lib/site";
import logoWhite from "@/assets/logo-white.svg";
import { analytics } from "@/lib/analytics";

/** Сколько кликов по логотипу открывают панель состояния и за какое время. */
const PANEL_CLICKS = 3;
const PANEL_WINDOW_MS = 1500;

export function Footer() {
  // Пасхалка: панель состояния стека открывается тройным кликом по логотипу.
  //
  // Тройным, а не одиночным, по двум причинам. Логотип в футере ничем не
  // отмечен как ссылка, и случайное попадание по нему у посетителя не должно
  // никуда уводить. Плюс панель закрыта паролем: одиночный клик показывал бы
  // случайному человеку окно авторизации браузера — недоумение на ровном месте.
  const panelTaps = useRef({ count: 0, last: 0 });

  function handleLogoTap() {
    const now = Date.now();
    const taps = panelTaps.current;
    taps.count = now - taps.last < PANEL_WINDOW_MS ? taps.count + 1 : 1;
    taps.last = now;
    if (taps.count >= PANEL_CLICKS) {
      taps.count = 0;
      window.open("/panel/", "_blank", "noopener");
    }
  }

  return (
    <footer className="bg-primary text-primary-foreground">
      <Container className="py-14 md:py-20">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-4">
          <Reveal variant="up">
            {/* Курсор намеренно обычный: пасхалка не должна выглядеть ссылкой. */}
            <img
              src={logoWhite}
              alt="EcoCub"
              className="mb-5 h-9 w-auto select-none"
              onClick={handleLogoTap}
            />
            <p className="text-sm leading-relaxed text-primary-foreground/70">
              Производство и строительство современных монолитно-модульных домов из бетона в
              Московской области.
            </p>
          </Reveal>

          <Reveal variant="up" delay={90}>
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-accent">
              Разделы
            </h3>
            <ul className="space-y-2">
              {mainNav.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className="nav-underline text-sm text-primary-foreground/80 transition-colors hover:text-accent"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal variant="up" delay={180}>
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-accent">
              Контакты
            </h3>
            <ul className="space-y-3 text-sm">
              <li>
                <a
                  href={site.phoneHref}
                  onClick={() => analytics.contactClick("phone", "footer")}
                  className="flex items-center gap-2 text-primary-foreground/90 hover:text-accent"
                >
                  <Phone className="size-4 shrink-0" />
                  {site.phone}
                </a>
              </li>
              <li>
                <a
                  href={`mailto:${site.email}`}
                  className="flex items-center gap-2 text-primary-foreground/90 hover:text-accent"
                >
                  <Mail className="size-4 shrink-0" />
                  {site.email}
                </a>
              </li>
              <li>
                <a
                  href={`mailto:${site.emailPartners}`}
                  className="flex items-center gap-2 text-primary-foreground/70 hover:text-accent"
                >
                  <Mail className="size-4 shrink-0" />
                  {site.emailPartners}
                </a>
              </li>
              <li className="flex items-start gap-2 text-primary-foreground/70">
                <MapPin className="mt-0.5 size-4 shrink-0" />
                Московская область
              </li>
            </ul>
          </Reveal>

          <Reveal variant="up" delay={270}>
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-accent">
              Связаться
            </h3>
            <div className="flex flex-col gap-3">
              <a
                href={site.whatsappHref}
                onClick={() => analytics.contactClick("whatsapp", "footer")}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-sm border border-primary-foreground/20 px-4 py-2 text-center text-sm transition-colors hover:border-accent hover:text-accent"
              >
                WhatsApp
              </a>
              <a
                href={site.telegramHref}
                onClick={() => analytics.contactClick("telegram", "footer")}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-sm border border-primary-foreground/20 px-4 py-2 text-center text-sm transition-colors hover:border-accent hover:text-accent"
              >
                Telegram
              </a>
            </div>
          </Reveal>
        </div>

        <Reveal className="mt-12 border-t border-primary-foreground/10 pt-8">
          <p className="text-center text-xl font-bold uppercase tracking-tight text-white/90 md:text-2xl">
            {site.brandTagline}
          </p>
        </Reveal>

        <div className="mt-8 flex flex-col gap-2 text-xs text-primary-foreground/50 sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} EcoCub. Все права защищены.</span>
          <span>Современные дома в Подмосковье</span>
        </div>
      </Container>
      {/* Служебный вход в разметку планировок. Мелкой строкой и без пароля —
          так решил владелец: страница ничего не меняет в боевом сайте, а
          разметка нужна под рукой. */}
      <div className="border-t border-white/10 py-3 text-center">
        <a
          href="/training"
          rel="nofollow"
          className="text-[11px] text-primary-foreground/30 transition-colors hover:text-primary-foreground/70"
        >
          обучение
        </a>
      </div>
    </footer>
  );
}
