import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { supabase } from "@/integrations/supabase/client";

const schema = z.object({
  name: z.string().trim().min(2, "Минимум 2 символа").max(100),
  phone: z
    .string()
    .trim()
    .min(5, "Введите телефон")
    .max(30)
    .regex(/^[+0-9\s\-()]+$/, "Неверный формат"),
  email: z
    .union([z.email("Неверный email").max(200), z.literal("")])
    .optional(),
  message: z.string().trim().max(2000).optional(),
  consent: z.literal(true, { error: "Нужно согласие" }),
});

type FormValues = z.infer<typeof schema>;

export type ContactFormProps = {
  formType?: "contact" | "project" | "presentation" | "callback";
  projectSlug?: string;
  sourcePage?: string;
  showMessage?: boolean;
  showEmail?: boolean;
  submitLabel?: string;
  className?: string;
  variant?: "light" | "dark";
};

export function ContactForm({
  formType = "contact",
  projectSlug,
  sourcePage,
  showMessage = true,
  showEmail = true,
  submitLabel = "Оставить заявку",
  className,
  variant = "light",
}: ContactFormProps) {
  const [pending, setPending] = useState(false);
  const isDark = variant === "dark";

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      phone: "",
      email: "",
      message: "",
      consent: false as unknown as true,
    },
  });

  const onSubmit = async (values: FormValues) => {
    setPending(true);
    try {
      const { error } = await supabase.from("submissions").insert({
        form_type: formType,
        name: values.name.trim(),
        phone: values.phone.trim(),
        email: values.email?.trim() || null,
        message: values.message?.trim() || null,
        project_slug: projectSlug ?? null,
        source_page:
          sourcePage ??
          (typeof window !== "undefined" ? window.location.pathname : null),
        status: "new",
      });
      if (error) throw error;
      toast.success("Заявка отправлена!", {
        description: "Мы свяжемся с вами в ближайшее время.",
      });
      form.reset();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Попробуйте ещё раз";
      toast.error("Не удалось отправить", { description: msg });
    } finally {
      setPending(false);
    }
  };

  const inputCls = isDark
    ? "border-white/20 bg-white/10 text-white placeholder:text-white/50 focus-visible:ring-accent"
    : "";

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={className}
        noValidate
      >
        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel className={isDark ? "text-white" : ""}>
                  Имя
                </FormLabel>
                <FormControl>
                  <Input
                    placeholder="Как к вам обращаться"
                    className={inputCls}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel className={isDark ? "text-white" : ""}>
                  Телефон
                </FormLabel>
                <FormControl>
                  <Input
                    type="tel"
                    inputMode="tel"
                    placeholder="+7 (___) ___-__-__"
                    className={inputCls}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {showEmail && (
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem className="mt-4">
                <FormLabel className={isDark ? "text-white" : ""}>
                  Email (необязательно)
                </FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    placeholder="you@example.com"
                    className={inputCls}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {showMessage && (
          <FormField
            control={form.control}
            name="message"
            render={({ field }) => (
              <FormItem className="mt-4">
                <FormLabel className={isDark ? "text-white" : ""}>
                  Комментарий
                </FormLabel>
                <FormControl>
                  <Textarea
                    rows={4}
                    placeholder="Площадь, участок, пожелания…"
                    className={inputCls}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <FormField
          control={form.control}
          name="consent"
          render={({ field }) => (
            <FormItem className="mt-5">
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1 size-4 rounded border-input"
                  checked={!!field.value}
                  onChange={(e) => field.onChange(e.target.checked)}
                />
                <span
                  className={
                    isDark
                      ? "text-xs text-white/70"
                      : "text-xs text-muted-foreground"
                  }
                >
                  Согласен на обработку персональных данных
                </span>
              </label>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button
          type="submit"
          size="lg"
          disabled={pending}
          className={
            isDark
              ? "mt-6 w-full bg-accent text-accent-foreground hover:bg-accent/90 sm:w-auto"
              : "mt-6 w-full sm:w-auto"
          }
        >
          {pending ? "Отправка…" : submitLabel}
        </Button>
      </form>
    </Form>
  );
}
