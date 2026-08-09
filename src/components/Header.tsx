import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Menu, Phone } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/Container";
import { LogoMark } from "@/components/LogoMark";
import { mainNav, site } from "@/lib/site";
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
          {mainNav.map((item) => (
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
          ))}
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
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setOpen(false)}
                  style={{ "--reveal-delay": `${i * 45}ms` } as React.CSSProperties}
                  className="rounded-md px-3 py-3 text-sm font-medium uppercase tracking-wider text-foreground transition-colors hover:bg-secondary hover:text-accent"
                  activeProps={{ className: "text-accent" }}
                >
                  {item.label}
                </Link>
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
