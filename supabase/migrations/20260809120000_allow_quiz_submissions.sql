-- Разрешаем заявки из квиза подбора проекта (form_type = 'quiz').
-- Прежняя политика ограничивала form_type четырьмя значениями, из-за чего
-- вставка заявок квиза отклонялась RLS и лид не сохранялся в submissions.
DROP POLICY IF EXISTS "Anyone can submit a valid request" ON public.submissions;

CREATE POLICY "Anyone can submit a valid request"
  ON public.submissions FOR INSERT
  WITH CHECK (
    form_type IN ('contact','project','presentation','callback','quiz')
    AND length(trim(name)) BETWEEN 2 AND 100
    AND length(trim(phone)) BETWEEN 5 AND 30
    AND (email IS NULL OR length(email) <= 200)
    AND (message IS NULL OR length(message) <= 2000)
    AND status = 'new'
  );
