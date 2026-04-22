
-- Fix function search_path
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Tighten submissions INSERT policy
DROP POLICY IF EXISTS "Anyone can submit a request" ON public.submissions;

CREATE POLICY "Anyone can submit a valid request"
  ON public.submissions FOR INSERT
  WITH CHECK (
    form_type IN ('contact','project','presentation','callback')
    AND length(trim(name)) BETWEEN 2 AND 100
    AND length(trim(phone)) BETWEEN 5 AND 30
    AND (email IS NULL OR length(email) <= 200)
    AND (message IS NULL OR length(message) <= 2000)
    AND status = 'new'
  );
