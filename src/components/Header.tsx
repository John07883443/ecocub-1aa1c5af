import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Menu, Phone } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/Container";
import { mainNav, site } from "@/lib/site";
import logoBlack from "@/assets/logo-black.svg";
import logoWhite from "@/assets/logo-white.svg";

interface HeaderProps {
  variant?: "light" | "dark";
}

export function Header({ variant = "light" }: HeaderProps) {
  const [open, setOpen] = useState(false);
  const isDark = variant === "dark";

  return (
    <header
      className={
        isDark
          ? "absolute inset-x-0 top-0 z-30 text-white"
          : "sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur"
      }
    >
      <Container className="flex h-20 items-center justify-between md:h-28">
        <Link to="/" className="group flex items-center gap-2 [perspective:800px]">
          <img
            src={isDark ? logoWhite : logoBlack}
            alt="EcoCub"
            className="h-16 w-auto md:h-18 origin-center transition-all duration-700 ease-out [transform-style:preserve-3d] group-hover:[transform:rotateY(360deg)] group-hover:[filter:drop-shadow(0_0_14px_color-mix(in_oklab,var(--accent)_55%,transparent))] motion-reduce:transition-none motion-reduce:group-hover:[transform:none] motion-reduce:group-hover:[filter:none]"
          />
        </Link>

        <nav className="hidden items-center gap-6 lg:flex">
          {mainNav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={
                isDark
                  ? "text-xs font-light uppercase tracking-wider text-white/90 transition-colors hover:text-accent"
                  : "text-xs font-light uppercase tracking-wider text-foreground/80 transition-colors hover:text-accent"
              }
              activeProps={{ className: "text-accent" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <a
            href={site.phoneHref}
            className={
              isDark
                ? "text-sm font-medium text-white"
                : "text-sm font-medium text-foreground"
            }
          >
            {site.phone}
          </a>
        </div>

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={isDark ? "text-white lg:hidden" : "lg:hidden"}
              aria-label="Открыть меню"
            >
              <Menu className="size-6" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[85vw] max-w-sm bg-background">
            <SheetTitle className="sr-only">Навигация</SheetTitle>
            <div className="mb-8 mt-2">
              <img src={logoBlack} alt="EcoCub" className="h-8 w-auto" />
            </div>
            <nav className="flex flex-col gap-1">
              {mainNav.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-3 text-sm font-medium uppercase tracking-wider text-foreground transition-colors hover:bg-secondary"
                  activeProps={{ className: "text-accent" }}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="mt-8 space-y-3 border-t border-border pt-6">
              <a
                href={site.phoneHref}
                className="flex items-center gap-2 text-base font-semibold"
              >
                <Phone className="size-4 text-accent" />
                {site.phone}
              </a>
              <a
                href={`mailto:${site.email}`}
                className="block text-sm text-muted-foreground"
              >
                {site.email}
              </a>
            </div>
          </SheetContent>
        </Sheet>
      </Container>
    </header>
  );
}
