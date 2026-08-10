/**
 * Реестр версий конструктора — единственный источник для /constructor-lab.
 * Новый эксперимент = одна запись здесь, страницу лаборатории править не надо.
 */

import type { ConstructorVersion } from "./types.ts";

export const CONSTRUCTOR_VERSIONS: ConstructorVersion[] = [
  {
    id: "quiz-v1",
    title: "Квиз подбора проекта",
    route: "/#quiz",
    status: "current",
    description:
      "Короткий коммерческий квиз на главной: 6 вопросов, ориентир площади и цены, заявка.",
  },
  {
    id: "dream-v1",
    title: "Дом мечты · карта потребностей",
    route: "/#dream",
    status: "current",
    description:
      "Подробная карта потребностей с живым изометрическим превью дома из кубиков и заявкой.",
  },
  {
    id: "constructor-v2",
    title: "3D-конструктор дома",
    route: "/constructor",
    status: "current",
    description:
      "Свободная сборка из модулей 3×3 м: план 2D, 3D-режим, дизайн фасада, площадь и цена.",
  },
  {
    id: "constructor-ai-v3",
    title: "AI-конструктор V3 · подбор дома под семью",
    route: "/constructor-ai-v3",
    status: "experiment",
    description:
      "Единый путь: квиз → вопросы об образе жизни → подбор из реальных планов EcoCub → редактирование → участок → фасад → проект.",
    createdAt: "2026-08-10",
  },
];
