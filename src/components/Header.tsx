import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, Menu, Phone } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/Container";
import { LogoMark } from "@/components/LogoMark";
import { constructorNav, mainNav, site } from "@/lib/site";
import { analytics } from "@/lib/analytics";
import { cn } from "@/lib/utils";

interface HeaderProps {
  variant?: "light" | "dark";
}

export function Header({ variant = "light" }: HeaderProps) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const isDark = variant === "dark";

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Прозрачная светлая типографика поверх героя — только пока не проскроллили.
  const onDark = isDark && !scrolled;
  // Плотная подложка: всегда на светлых страницах, а на тёмной — после скролла.
  const solid = !isDark || scrolled;

  return (
    <header
      className={cn(
        "z-40 transition-[background-color,box-shadow,border-color,backdrop-filter] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]",
        isDark ? "fixed inset-x-0 top-0" : "sticky top-0",
        onDark ? "text-white" : "text-foreground",
        solid
          ? "border-b border-border bg-background/85 supports-[backdrop-filter]:bg-background/70 backdrop-blur-md"
          : "border-b border-transparent bg-transparent",
        scrolled ? "shadow-[0_8px_30px_-12px_rgba(0,0,0,0.25)]" : "",
      )}
    >
      <Container
        className={cn(
          "flex items-center justify-between transition-[height] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]",
          scrolled ? "h-16 md:h-20" : "h-20 md:h-28",
        )}
      >
        <Link to="/" className="flex items-center gap-2">
          <LogoMark
            variant={onDark ? "dark" : "light"}
            className={cn(
              "w-auto transition-[height] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]",
              scrolled ? "h-12 md:h-14" : "h-16 md:h-18",
            )}
          />
        </Link>

        <nav className="hidden items-center gap-6 lg:flex">
          {mainNav.map((item) =>
            item.to === "/constructor" ? (
              <ConstructorDropdown key={item.to} label={item.label} onDark={onDark} />
            ) : (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "nav-underline text-xs font-light uppercase tracking-wider transition-colors hover:text-accent",
                  onDark ? "text-white/90" : "text-foreground/80",
                )}
                activeProps={{ className: "text-accent" }}
              >
                {item.label}
              </Link>
            ),
          )}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <a
            href={site.phoneHref}
            onClick={() => analytics.contactClick("phone", "header")}
            className={cn(
              "text-sm font-medium transition-colors hover:text-accent",
              onDark ? "text-white" : "text-foreground",
            )}
          >
            {site.phone}
          </a>
        </div>

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(onDark ? "text-white" : "", "lg:hidden")}
              aria-label="Открыть меню"
            >
              <Menu className="size-6" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[85vw] max-w-sm bg-background">
            <SheetTitle className="sr-only">Навигация</SheetTitle>
            <div className="mb-8 mt-2">
              <LogoMark variant="light" className="h-8 w-auto" />
            </div>
            <nav className="flex flex-col gap-1">
              {mainNav.map((item, i) => (
                <div key={item.to}>
                  <Link
                    to={item.to}
                    onClick={() => setOpen(false)}
                    style={{ "--reveal-delay": `${i * 45}ms` } as React.CSSProperties}
                    className="block rounded-md px-3 py-3 text-sm font-medium uppercase tracking-wider text-foreground transition-colors hover:bg-secondary hover:text-accent"
                    activeProps={{ className: "text-accent" }}
                  >
                    {item.label}
                  </Link>
                  {/* Все версии конструктора — сразу под родительским пунктом */}
                  {item.to === "/constructor" && (
                    <div className="mb-1 ml-3 flex flex-col gap-0.5 border-l border-border pl-3">
                      {constructorNav.map((sub) => (
                        <a
                          key={sub.to}
                          href={sub.to}
                          onClick={() => {
                            analytics.ctaClick("header-constructor-menu", sub.label);
                            setOpen(false);
                          }}
                          className="rounded-md px-2 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-secondary hover:text-accent"
                        >
                          {sub.label}
                          {sub.badge && (
                            <span className="ml-2 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-accent">
                              {sub.badge}
                            </span>
                          )}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </nav>
            <div className="mt-8 space-y-3 border-t border-border pt-6">
              <a
                href={site.phoneHref}
                onClick={() => analytics.contactClick("phone", "header")}
                className="flex items-center gap-2 text-base font-semibold"
              >
                <Phone className="size-4 text-accent" />
                {site.phone}
              </a>
              <a href={`mailto:${site.email}`} className="block text-sm text-muted-foreground">
                {site.email}
              </a>
            </div>
          </SheetContent>
        </Sheet>
      </Container>
    </header>
  );
}

/**
 * Пункт «Конструктор» с выпадающим меню всех версий (десктоп).
 *
 * Открывается по наведению и по фокусу с клавиатуры (group-hover +
 * focus-within — CSS-решение без JS-состояния), клик по самому пункту
 * по-прежнему ведёт на /constructor, так что старое поведение сохранено.
 * Панель непрозрачная: шапка полупрозрачная с blur, и меню не должно
 * просвечивать контентом страницы.
 */
function ConstructorDropdown({ label, onDark }: { label: string; onDark: boolean }) {
  return (
    <div className="group relative">
      <Link
        to="/constructor"
        className={cn(
          "nav-underline inline-flex items-center gap-1 text-xs font-light uppercase tracking-wider transition-colors hover:text-accent",
          onDark ? "text-white/90" : "text-foreground/80",
        )}
        activeProps={{ className: "text-accent" }}
        aria-haspopup="menu"
      >
        {label}
        <ChevronDown className="size-3 transition-transform duration-200 group-hover:rotate-180" />
      </Link>

      {/* pt-3 — мостик между пунктом и панелью, чтобы hover не обрывался */}
      <div className="invisible absolute left-1/2 top-full z-50 w-80 -translate-x-1/2 pt-3 opacity-0 transition-[opacity,visibility] duration-200 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
        <div className="overflow-hidden rounded-sm border border-border bg-background shadow-[0_16px_40px_-12px_rgba(0,0,0,0.3)]">
          {constructorNav.map((sub) => (
            <a
              key={sub.to}
              href={sub.to}
              onClick={() => analytics.ctaClick("header-constructor-menu", sub.label)}
              className="block border-b border-border/60 px-4 py-3 transition-colors last:border-b-0 hover:bg-secondary"
            >
              <span className="flex items-center text-sm font-medium text-foreground">
                {sub.label}
                {sub.badge && (
                  <span className="ml-2 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-accent">
                    {sub.badge}
                  </span>
                )}
              </span>
              {sub.hint && (
                <span className="mt-0.5 block text-xs text-muted-foreground">{sub.hint}</span>
              )}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
