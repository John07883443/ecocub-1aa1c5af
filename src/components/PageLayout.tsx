import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export function PageLayout({
  children,
  headerVariant = "light",
}: {
  children: React.ReactNode;
  headerVariant?: "light" | "dark";
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header variant={headerVariant} />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
