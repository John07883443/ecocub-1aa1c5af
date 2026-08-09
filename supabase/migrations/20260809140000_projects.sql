-- Проекты домов: схема и перенос данных из content/projects/*.json.
--
-- Модель доступа: сайт читает опубликованные карточки, писать снаружи нельзя.
-- RLS включён, наружу открыт единственный сценарий — SELECT опубликованного.
-- Правки идут либо из дашборда, либо позже из админки с ключом service_role,
-- который RLS обходит и живёт только в переменных окружения сервера.

CREATE TABLE IF NOT EXISTS public.projects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,
  name          text NOT NULL,
  series        text NOT NULL DEFAULT 'concrete',
  tagline       text,
  description   text,
  area_m2       numeric,
  bedrooms      int,
  bathrooms     int,
  floors        int,
  price_from    numeric,
  cover_image   text NOT NULL,
  gallery       jsonb NOT NULL DEFAULT '[]'::jsonb,
  features      jsonb NOT NULL DEFAULT '[]'::jsonb,
  display_order int NOT NULL DEFAULT 0,
  published     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- updated_at нужен карте сайта как lastmod, поэтому обновляем его триггером,
-- а не надеемся, что редактор не забудет проставить дату руками.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_projects_updated_at ON public.projects;
CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_projects_series
  ON public.projects (series) WHERE published;
CREATE INDEX IF NOT EXISTS idx_projects_display_order
  ON public.projects (display_order);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Единственная политика: читать можно только опубликованные карточки.
-- Черновик (published = false) снаружи не виден вообще.
DROP POLICY IF EXISTS "Опубликованные проекты доступны на чтение" ON public.projects;
CREATE POLICY "Опубликованные проекты доступны на чтение"
  ON public.projects FOR SELECT
  USING (published);

-- При создании проекта автоматическая выдача прав новым таблицам отключена,
-- поэтому право на чтение выдаём явно. INSERT/UPDATE/DELETE не выдаём никому:
-- запись возможна только ключом service_role, который RLS и права обходит.
GRANT SELECT ON public.projects TO anon, authenticated;

-- Данные. ON CONFLICT — чтобы повторный прогон миграции не падал и не двоил.
INSERT INTO public.projects
  (slug, name, series, tagline, description, area_m2, bedrooms, bathrooms,
   floors, price_from, cover_image, gallery, features, display_order, published)
VALUES
  ('family-one', 'Family One', 'villa', 'Семейный дом с тремя спальнями', 'Просторный модульный бетонный дом для большой семьи. Три спальни, две санузла, гостиная-кухня с панорамным остеклением, потолки 3,15 м.', 146, 3, 2, 1, 12000000, '/images/projects/family-one.jpg', '["/images/projects/family-one.jpg", "/images/projects/family-one-2.jpg", "/images/projects/family-one-3.jpg", "/images/interiors/living-1.jpg", "/images/interiors/bathroom-1.jpg"]'::jsonb, '["Потолки 3,15 м", "Три спальни", "Два санузла", "Гардеробные", "Панорамные окна", "Готовая инженерия"]'::jsonb, 4, true),
  ('family-two', 'Family Two', 'villa', 'Премиум-вилла Hi-Tech из бетона', 'Премиальная вилла из бетонных модулей в стиле Hi-Tech. Три спальни, гардеробные, две ванные, кухня-гостиная с панорамой. Потолки 3,15 м.', 163, 3, 2, 1, 13000000, '/images/projects/family-two.jpg', '["/images/projects/family-two.jpg", "/images/projects/family-two-2.jpg", "/images/interiors/living-2.jpg", "/images/interiors/bedroom-1.jpg", "/images/interiors/bathroom-1.jpg"]'::jsonb, '["Премиум-вилла Hi-Tech", "Потолки 3,15 м", "Три спальни и две ванные", "Кухня-гостиная с панорамой", "Гардеробные", "Бассейн (опция)", "Эксплуатируемая кровля"]'::jsonb, 5, true),
  ('sky-river', 'Sky River', 'concrete', 'Двухкомнатный дом с панорамой на природу', 'Модульный бетонный дом с двумя спальнями и просторной гостиной-кухней. Потолки 3,15 м.', 85, 2, 1, 1, 8500000, '/images/projects/sky-river.jpg', '["/images/projects/sky-river.jpg", "/images/projects/sky-river-2.jpg", "/images/projects/sky-river-3.jpg", "/images/interiors/living-2.jpg", "/images/interiors/kitchen-1.jpg"]'::jsonb, '["Потолки 3,15 м", "Панорамные окна с видом на природу", "Две спальни", "Терраса с зоной барбекю", "Тёплые полы", "Готовая инженерия"]'::jsonb, 2, true),
  ('weekend-one', 'Weekend One', 'concrete', 'Компактный модульный дом с панорамным остеклением', 'Однокомнатный модульный дом из бетона для круглогодичного проживания. Высота потолков 3,15 м, панорамные окна, готовая инженерия. Идеален как дача или гостевой дом.', 55, 1, 1, 1, 5500000, '/images/projects/weekend-one.jpg', '["/images/projects/weekend-one.jpg", "/images/projects/weekend-one-2.jpg", "/images/interiors/living-1.jpg", "/images/interiors/bedroom-1.jpg"]'::jsonb, '["Потолки 3,15 м", "Панорамное остекление", "Тёплые полы по всему периметру", "Готовая черновая инженерия", "Чистовая отделка фасада", "Эксплуатируемая кровля"]'::jsonb, 1, true),
  ('weekend-two', 'Weekend Two', 'concrete', 'Просторный одноэтажный дом для семьи', 'Одноэтажный модульный дом из бетона с двумя спальнями, кабинетом и гостиной с панорамным остеклением. Потолки 3,15 м.', 124, 2, 2, 1, 10000000, '/images/projects/weekend-two.jpg', '["/images/projects/weekend-two.jpg", "/images/projects/weekend-two-2.jpg", "/images/interiors/kitchen-1.jpg", "/images/interiors/bedroom-2.jpg"]'::jsonb, '["Потолки 3,15 м", "Две спальни и кабинет", "Просторная кухня-гостиная", "Два санузла", "Панорамное остекление", "Чистовая отделка фасада"]'::jsonb, 3, true)
ON CONFLICT (slug) DO NOTHING;
