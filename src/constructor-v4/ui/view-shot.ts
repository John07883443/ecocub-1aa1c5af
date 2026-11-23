/**
 * Снимок 3D с камеры кадра (стадия 1 → вход стадии 2). Сцена (Scene.tsx)
 * регистрирует здесь функцию съёмки, пока смонтирована; рендер-кнопка зовёт
 * shootView(). Сцены нет (открыт план, не тот таб) — null, кадр рисуется по промпту.
 */
import type { CameraView } from "../engine/render-plan.ts";

export type ViewShooter = (view: CameraView, size: { w: number; h: number }) => string | null;

let shooter: ViewShooter | null = null;

export function registerViewShooter(fn: ViewShooter | null): void {
  shooter = fn;
}

/** PNG data URL снимка с камеры кадра или null. */
export function shootView(view: CameraView, size: { w: number; h: number }): string | null {
  try {
    return shooter ? shooter(view, size) : null;
  } catch {
    return null;
  }
}
