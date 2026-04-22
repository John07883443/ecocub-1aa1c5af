-- Удаляем scandi проекты
DELETE FROM public.projects WHERE series = 'scandi';

-- Категории блога
CREATE TYPE public.blog_category AS ENUM ('tech', 'cases', 'comparison', 'news');

-- Таблица статей блога
CREATE TABLE public.blog_posts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  excerpt TEXT,
  content TEXT NOT NULL,
  cover_image TEXT,
  category public.blog_category NOT NULL DEFAULT 'tech',
  published BOOLEAN NOT NULL DEFAULT false,
  published_at TIMESTAMP WITH TIME ZONE,
  reading_time INTEGER NOT NULL DEFAULT 5,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.blog_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view published blog posts"
  ON public.blog_posts FOR SELECT
  USING (published = true);

CREATE POLICY "Admins can manage blog posts"
  ON public.blog_posts FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER blog_posts_updated_at
  BEFORE UPDATE ON public.blog_posts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_blog_posts_published ON public.blog_posts (published, published_at DESC);
CREATE INDEX idx_blog_posts_category ON public.blog_posts (category);

-- Таблица конфигурации ценообразования
CREATE TABLE public.pricing_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value_numeric NUMERIC,
  value_text TEXT,
  description TEXT,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.pricing_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view pricing config"
  ON public.pricing_config FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage pricing config"
  ON public.pricing_config FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER pricing_config_updated_at
  BEFORE UPDATE ON public.pricing_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Базовая цена 105 000 ₽/м²
INSERT INTO public.pricing_config (key, value_numeric, description) VALUES
  ('base_price_per_m2', 105000, 'Базовая цена за квадратный метр (предчистовая отделка), ₽'),
  ('warranty_years', 50, 'Гарантия на конструкцию, лет'),
  ('lifespan_years', 120, 'Срок службы дома, лет'),
  ('production_days', 90, 'Срок производства модулей, дней'),
  ('assembly_days', 5, 'Срок монтажа на участке, дней');