/**
 * Архитектурные обозначения мебели — вид сверху, локальные SVG.
 *
 * Каждый предмет рисуется в собственной системе координат spec.w × spec.d
 * (ширина вдоль стены × глубина от стены), а поворот применяет вызывающий
 * слой. Стиль единый: тонкие серо-графитовые линии, без emoji и сторонних
 * пиктограмм. Слой мебели не перехватывает указатель — hit-area принадлежит
 * модулю, поэтому drag и tap работают поверх рисунка.
 */

import { FURNITURE_CATALOG } from "@/lib/planner/constants";
import type { FurnitureItem, FurnitureKind } from "@/lib/planner/types";

/** Толщины линий в метрах плана: одинаковы для всех предметов. */
const LINE = 0.045;
const LINE_THIN = 0.03;
const STROKE = "#6b6f6a";
const FILL = "#ffffff";
const SOFT = "#eceae5";

function Shape({ kind }: { kind: FurnitureKind }) {
  const { w, d } = FURNITURE_CATALOG[kind];
  const common = {
    fill: FILL,
    stroke: STROKE,
    strokeWidth: LINE,
    vectorEffect: "non-scaling-stroke" as const,
  };

  switch (kind) {
    case "bed":
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} {...common} />
          {/* Изголовье сверху (у стены) и две подушки */}
          <rect
            x={0}
            y={0}
            width={w}
            height={0.18}
            fill={SOFT}
            stroke={STROKE}
            strokeWidth={LINE_THIN}
          />
          <rect
            x={0.12}
            y={0.24}
            width={w / 2 - 0.2}
            height={0.42}
            fill={SOFT}
            stroke={STROKE}
            strokeWidth={LINE_THIN}
          />
          <rect
            x={w / 2 + 0.08}
            y={0.24}
            width={w / 2 - 0.2}
            height={0.42}
            fill={SOFT}
            stroke={STROKE}
            strokeWidth={LINE_THIN}
          />
          {/* Складка покрывала */}
          <line
            x1={0.1}
            y1={d - 0.5}
            x2={w - 0.1}
            y2={d - 0.5}
            stroke={STROKE}
            strokeWidth={LINE_THIN}
          />
        </g>
      );
    case "nightstand":
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} {...common} />
          <line
            x1={0.08}
            y1={d / 2}
            x2={w - 0.08}
            y2={d / 2}
            stroke={STROKE}
            strokeWidth={LINE_THIN}
          />
        </g>
      );
    case "wardrobe":
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} {...common} />
          <line x1={w / 2} y1={0} x2={w / 2} y2={d} stroke={STROKE} strokeWidth={LINE_THIN} />
          <line x1={0} y1={d * 0.75} x2={w} y2={d * 0.75} stroke={STROKE} strokeWidth={LINE_THIN} />
        </g>
      );
    case "shelf":
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} {...common} />
          {[0.25, 0.5, 0.75].map((t) => (
            <line
              key={t}
              x1={w * t}
              y1={0}
              x2={w * t}
              y2={d}
              stroke={STROKE}
              strokeWidth={LINE_THIN}
            />
          ))}
        </g>
      );
    case "sofa":
      return (
        <g>
          {/* Спинка у стены, подлокотники, две подушки */}
          <rect x={0} y={0} width={w} height={d} {...common} />
          <rect
            x={0}
            y={0}
            width={w}
            height={0.22}
            fill={SOFT}
            stroke={STROKE}
            strokeWidth={LINE_THIN}
          />
          <rect
            x={0}
            y={0}
            width={0.22}
            height={d}
            fill={SOFT}
            stroke={STROKE}
            strokeWidth={LINE_THIN}
          />
          <rect
            x={w - 0.22}
            y={0}
            width={0.22}
            height={d}
            fill={SOFT}
            stroke={STROKE}
            strokeWidth={LINE_THIN}
          />
          <line
            x1={w / 2}
            y1={0.24}
            x2={w / 2}
            y2={d - 0.04}
            stroke={STROKE}
            strokeWidth={LINE_THIN}
          />
        </g>
      );
    case "coffee-table":
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} rx={0.08} {...common} />
        </g>
      );
    case "tv":
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} fill={SOFT} stroke={STROKE} strokeWidth={LINE} />
          <line x1={w * 0.2} y1={d} x2={w * 0.8} y2={d} stroke={STROKE} strokeWidth={LINE_THIN} />
        </g>
      );
    case "kitchen-line":
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} {...common} />
          {/* Мойка и варочная панель */}
          <rect
            x={0.25}
            y={0.12}
            width={0.5}
            height={0.36}
            fill="none"
            stroke={STROKE}
            strokeWidth={LINE_THIN}
            rx={0.05}
          />
          <circle
            cx={w - 0.75}
            cy={d / 2}
            r={0.13}
            fill="none"
            stroke={STROKE}
            strokeWidth={LINE_THIN}
          />
          <circle
            cx={w - 0.45}
            cy={d / 2}
            r={0.13}
            fill="none"
            stroke={STROKE}
            strokeWidth={LINE_THIN}
          />
          <line x1={0} y1={d} x2={w} y2={d} stroke={STROKE} strokeWidth={LINE} />
        </g>
      );
    case "dining-table":
      return <rect x={0} y={0} width={w} height={d} rx={0.06} {...common} />;
    case "chair":
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} rx={0.06} {...common} />
          <line
            x1={0.06}
            y1={0.08}
            x2={w - 0.06}
            y2={0.08}
            stroke={STROKE}
            strokeWidth={LINE_THIN}
          />
        </g>
      );
    case "desk":
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} {...common} />
          <line
            x1={w - 0.45}
            y1={0.06}
            x2={w - 0.45}
            y2={d - 0.06}
            stroke={STROKE}
            strokeWidth={LINE_THIN}
          />
        </g>
      );
    case "office-chair":
      return (
        <g>
          <circle cx={w / 2} cy={d / 2} r={Math.min(w, d) / 2 - 0.02} {...common} />
          <line
            x1={w * 0.2}
            y1={d * 0.2}
            x2={w * 0.8}
            y2={d * 0.2}
            stroke={STROKE}
            strokeWidth={LINE_THIN}
          />
        </g>
      );
    case "bath":
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} rx={0.12} {...common} />
          <rect
            x={0.1}
            y={0.09}
            width={w - 0.2}
            height={d - 0.18}
            rx={0.1}
            fill="none"
            stroke={STROKE}
            strokeWidth={LINE_THIN}
          />
          <circle cx={w - 0.22} cy={d / 2} r={0.05} fill={STROKE} />
        </g>
      );
    case "shower":
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} {...common} />
          <line x1={0} y1={0} x2={w} y2={d} stroke={STROKE} strokeWidth={LINE_THIN} />
          <line x1={w} y1={0} x2={0} y2={d} stroke={STROKE} strokeWidth={LINE_THIN} />
          <circle
            cx={w / 2}
            cy={d / 2}
            r={0.09}
            fill="none"
            stroke={STROKE}
            strokeWidth={LINE_THIN}
          />
        </g>
      );
    case "toilet":
      return (
        <g>
          <rect x={0.04} y={0} width={w - 0.08} height={0.16} {...common} />
          <ellipse cx={w / 2} cy={d * 0.62} rx={w / 2 - 0.03} ry={d * 0.32} {...common} />
        </g>
      );
    case "sink":
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} rx={0.06} {...common} />
          <circle
            cx={w / 2}
            cy={d * 0.55}
            r={Math.min(w, d) * 0.28}
            fill="none"
            stroke={STROKE}
            strokeWidth={LINE_THIN}
          />
        </g>
      );
    case "washer":
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} {...common} />
          <circle
            cx={w / 2}
            cy={d / 2}
            r={Math.min(w, d) * 0.3}
            fill="none"
            stroke={STROKE}
            strokeWidth={LINE_THIN}
          />
        </g>
      );
    case "armchair":
      // Кресло: спинка толще подлокотников, как на чертежах террас.
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} rx={0.1} {...common} />
          <rect
            x={0.08}
            y={0.18}
            width={w - 0.16}
            height={d - 0.26}
            rx={0.08}
            fill={SOFT}
            stroke={STROKE}
            strokeWidth={LINE_THIN}
          />
        </g>
      );
    case "dresser":
      // Комод: три ящика. Подписан прямо на планах Family One и Family Two.
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} {...common} />
          {[1, 2].map((i) => (
            <line
              key={i}
              x1={(w / 3) * i}
              y1={0}
              x2={(w / 3) * i}
              y2={d}
              stroke={STROKE}
              strokeWidth={LINE_THIN}
            />
          ))}
        </g>
      );
    case "round-table":
      return (
        <g>
          <circle cx={w / 2} cy={d / 2} r={Math.min(w, d) / 2} {...common} />
          <circle
            cx={w / 2}
            cy={d / 2}
            r={Math.min(w, d) / 6}
            fill="none"
            stroke={STROKE}
            strokeWidth={LINE_THIN}
          />
        </g>
      );
    case "kitchen-island":
      // Остров: столешница с врезанной мойкой. Подписан на плане Nasledie.
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} rx={0.04} {...common} />
          <rect
            x={w - 0.75}
            y={0.18}
            width={0.5}
            height={d - 0.36}
            rx={0.05}
            fill="none"
            stroke={STROKE}
            strokeWidth={LINE_THIN}
          />
        </g>
      );
    case "fridge":
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} {...common} />
          <line x1={0} y1={d * 0.38} x2={w} y2={d * 0.38} stroke={STROKE} strokeWidth={LINE_THIN} />
          <line
            x1={w - 0.12}
            y1={d * 0.18}
            x2={w - 0.12}
            y2={d * 0.3}
            stroke={STROKE}
            strokeWidth={LINE_THIN}
          />
        </g>
      );
    case "dryer":
      // Сушильная машина: на плане Nasledie подписана «Суш.м» рядом со «Ст.м».
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} {...common} />
          <circle
            cx={w / 2}
            cy={d / 2}
            r={Math.min(w, d) / 3}
            fill="none"
            stroke={STROKE}
            strokeWidth={LINE_THIN}
          />
          <line x1={0.1} y1={0.12} x2={w - 0.1} y2={0.12} stroke={STROKE} strokeWidth={LINE_THIN} />
        </g>
      );
    case "tv-unit":
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} {...common} />
          <line x1={0} y1={d / 2} x2={w} y2={d / 2} stroke={STROKE} strokeWidth={LINE_THIN} />
        </g>
      );
    case "single-bed":
      // Односпальная: та же кровать, одна подушка.
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} rx={0.06} {...common} />
          <rect
            x={0.08}
            y={0.1}
            width={w - 0.16}
            height={0.42}
            rx={0.06}
            fill={SOFT}
            stroke={STROKE}
            strokeWidth={LINE_THIN}
          />
          <path
            d={`M 0.1 ${d * 0.55} Q ${w / 2} ${d * 0.72} ${w - 0.1} ${d * 0.55}`}
            fill="none"
            stroke={STROKE}
            strokeWidth={LINE_THIN}
          />
        </g>
      );
    case "double-sink":
      // Двойная раковина: у Dinastiya в общей ванной их две.
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} rx={0.05} {...common} />
          {[0.25, 0.75].map((k) => (
            <ellipse
              key={k}
              cx={w * k}
              cy={d / 2}
              rx={w * 0.18}
              ry={d * 0.3}
              fill="none"
              stroke={STROKE}
              strokeWidth={LINE_THIN}
            />
          ))}
        </g>
      );
    case "boiler":
      // Бойлер: у Weekend One под него отведена каморка 0,57 м².
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} rx={0.06} {...common} />
          <line
            x1={0.1}
            y1={d - 0.1}
            x2={w - 0.1}
            y2={d - 0.1}
            stroke={STROKE}
            strokeWidth={LINE_THIN}
          />
        </g>
      );
    case "plant":
      return (
        <g>
          <circle
            cx={w / 2}
            cy={d / 2}
            r={Math.min(w, d) / 2}
            fill={FILL}
            stroke={STROKE}
            strokeWidth={LINE_THIN}
          />
          {[0, 60, 120, 180, 240, 300].map((a) => {
            const r = Math.min(w, d) / 2;
            const rad = (a * Math.PI) / 180;
            return (
              <line
                key={a}
                x1={w / 2}
                y1={d / 2}
                x2={w / 2 + Math.cos(rad) * r * 0.9}
                y2={d / 2 + Math.sin(rad) * r * 0.9}
                stroke={STROKE}
                strokeWidth={LINE_THIN}
              />
            );
          })}
        </g>
      );
    case "wardrobe-rail":
      // Гардеробная штанга: у Nasledie отдельный гардероб 3,6 м².
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} {...common} />
          <line
            x1={0.1}
            y1={d * 0.35}
            x2={w - 0.1}
            y2={d * 0.35}
            stroke={STROKE}
            strokeWidth={LINE}
          />
          {[0.2, 0.4, 0.6, 0.8].map((k) => (
            <line
              key={k}
              x1={w * k}
              y1={d * 0.35}
              x2={w * k}
              y2={d * 0.8}
              stroke={STROKE}
              strokeWidth={LINE_THIN}
            />
          ))}
        </g>
      );
    case "bench":
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} rx={0.05} {...common} />
          <line x1={0} y1={0.1} x2={w} y2={0.1} stroke={STROKE} strokeWidth={LINE_THIN} />
        </g>
      );
    case "stairs-run": {
      const steps = 9;
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} {...common} />
          {Array.from({ length: steps - 1 }, (_, i) => (
            <line
              key={i}
              x1={0}
              y1={(d / steps) * (i + 1)}
              x2={w}
              y2={(d / steps) * (i + 1)}
              stroke={STROKE}
              strokeWidth={LINE_THIN}
            />
          ))}
          {/* Стрелка направления подъёма */}
          <line x1={w / 2} y1={d - 0.15} x2={w / 2} y2={0.2} stroke={STROKE} strokeWidth={LINE} />
          <polyline
            points={`${w / 2 - 0.12},${0.36} ${w / 2},${0.16} ${w / 2 + 0.12},${0.36}`}
            fill="none"
            stroke={STROKE}
            strokeWidth={LINE}
          />
        </g>
      );
    }
    case "lounge":
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} rx={0.1} {...common} />
          <line
            x1={w / 3}
            y1={0.06}
            x2={w / 3}
            y2={d - 0.06}
            stroke={STROKE}
            strokeWidth={LINE_THIN}
          />
          <line
            x1={(w * 2) / 3}
            y1={0.06}
            x2={(w * 2) / 3}
            y2={d - 0.06}
            stroke={STROKE}
            strokeWidth={LINE_THIN}
          />
        </g>
      );
    case "outdoor-table":
      return (
        <g>
          <circle cx={w / 2} cy={d / 2} r={Math.min(w, d) / 2 - 0.04} {...common} />
        </g>
      );
    default:
      // Неизвестный тип — нейтральный прямоугольник, план не ломается.
      return <rect x={0} y={0} width={w} height={d} {...common} />;
  }
}

/**
 * Предмет на плане: занимаемая область известна из модели, а рисунок
 * поворачивается вокруг её центра.
 */
export function FurnitureShape({ item }: { item: FurnitureItem }) {
  const spec = FURNITURE_CATALOG[item.kind];
  const cx = item.x + item.w / 2;
  const cz = item.z + item.d / 2;
  // Локальная система: spec.w вдоль стены, spec.d от стены. При повороте
  // на 90/270 занимаемая область меняет стороны, центр остаётся тем же.
  return (
    <g
      transform={`translate(${cx} ${cz}) rotate(${item.rotation}) translate(${-spec.w / 2} ${-spec.d / 2})`}
      style={{ pointerEvents: "none" }}
    >
      <Shape kind={item.kind} />
    </g>
  );
}
