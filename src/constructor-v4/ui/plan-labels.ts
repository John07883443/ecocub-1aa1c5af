/**
 * Размер шрифта в мм плана, чтобы на экране он был не меньше minPx: на обзорном
 * масштабе подписи «ТВ», «диван» иначе выходят по 5 px.
 */
export function labelFontMm(baseMm: number, minPx: number, pxPerMm: number): number {
  if (!(pxPerMm > 0)) return baseMm;
  return Math.max(baseMm, Math.ceil(minPx / pxPerMm));
}
