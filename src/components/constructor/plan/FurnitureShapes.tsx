/**
 * Архитектурные обозначения мебели — вид сверху.
 *
 * Каждый предмет рисуется в своей системе координат spec.w × spec.d (ширина
 * вдоль стены × глубина от стены); поворот применяет вызывающий слой.
 *
 * Две вещи, из-за которых прежние обозначения не читались.
 *
 * Первая — толщина линий. У всех фигур стоял `vector-effect: non-scaling-stroke`,
 * а это переводит толщину из метров плана в пиксели экрана: 0,045 превращалось
 * в сорок пять тысячных пикселя, то есть в почти невидимый волосок. Единица
 * этого SVG — метр, и толщины теперь тоже в метрах: 5 см на контур предмета,
 * 2,5 см на внутреннюю деталь. Тоньше стены дома (16 см) и толще ничего.
 *
 * Вторая — отсутствие тона. Белый прямоугольник с тонкой рамкой читается как
 * пустое место, чем бы он ни был. Поэтому у обозначений появились заливки:
 * мягкая тёплая у мягкой мебели, светлое дерево у столов и шкафов, белая у
 * сантехники и техники, зеленоватая у растений. Плана это не расцвечивает —
 * все четыре тона почти одного светлого веса, — но кровать перестаёт быть
 * похожей на комод.
 */

import { FURNITURE_CATALOG } from "@/lib/planner/constants";
import type { FurnitureItem, FurnitureKind } from "@/lib/planner/types";

/** Толщины в метрах плана. Контур предмета вчетверо тоньше наружной стены. */
const LINE = 0.05;
const THIN = 0.025;

const INK = "#4a4d48";
/** Мягкая мебель: диваны, кресла, кровати. */
const SOFT = "#e7e2d8";
/** Дерево: столы, шкафы, комоды, стеллажи. */
const WOOD = "#f1ebe1";
/** Сантехника и техника — белая, как в жизни. */
const WHITE = "#ffffff";
/** Зелень. Единственное цветное пятно на чертеже, и то приглушённое. */
const LEAF = "#dfe7dd";

/** Общие атрибуты контура. Толщина в метрах — не в пикселях. */
const line = { stroke: INK, strokeWidth: LINE, strokeLinejoin: "round" as const };
const thin = { stroke: INK, strokeWidth: THIN, fill: "none" };
/** То же, но с заливкой: деталь, у которой своя подложка. */
const filled = (fill: string) => ({ stroke: INK, strokeWidth: THIN, fill });

function Shape({ kind }: { kind: FurnitureKind }) {
  const { w, d } = FURNITURE_CATALOG[kind];

  switch (kind) {
    /* ---------------------------------------------------------------- */
    /* Спальня                                                           */
    /* ---------------------------------------------------------------- */
    case "bed":
    case "single-bed": {
      const single = kind === "single-bed";
      const headboard = 0.12;
      const pillowTop = headboard + 0.06;
      const pillowH = 0.42;
      const blanket = pillowTop + pillowH + 0.05;
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} rx={0.05} fill={SOFT} {...line} />
          {/* Изголовье — плотная полоса у стены: сразу видно, где голова */}
          <rect x={0} y={0} width={w} height={headboard} fill={INK} stroke="none" />
          {/* Подушки: две у двуспальной, одна у односпальной */}
          {(single ? [0.5] : [0.27, 0.73]).map((k) => (
            <rect
              key={k}
              x={w * k - (single ? w * 0.32 : w * 0.2)}
              y={pillowTop}
              width={single ? w * 0.64 : w * 0.4}
              height={pillowH}
              rx={0.08}
              {...filled(WHITE)}
            />
          ))}
          {/* Одеяло: отворот и складки — узнаваемый приём чертежа */}
          <rect
            x={0.06}
            y={blanket}
            width={w - 0.12}
            height={d - blanket - 0.06}
            rx={0.06}
            {...filled(WHITE)}
          />
          <line x1={0.06} y1={blanket + 0.22} x2={w - 0.06} y2={blanket + 0.22} {...thin} />
          {[0.33, 0.66].map((k) => (
            <line key={k} x1={w * k} y1={blanket + 0.28} x2={w * k} y2={d - 0.1} {...thin} />
          ))}
        </g>
      );
    }
    case "nightstand":
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} rx={0.03} fill={WOOD} {...line} />
          <circle cx={w / 2} cy={d * 0.62} r={0.05} fill={INK} stroke="none" />
        </g>
      );
    case "dresser":
      // Комод: три ящика с ручками. Подписан на планах Family One и Family Two.
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} fill={WOOD} {...line} />
          {[1, 2].map((i) => (
            <line key={i} x1={(w / 3) * i} y1={0} x2={(w / 3) * i} y2={d} {...thin} />
          ))}
          {[0.5, 1.5, 2.5].map((i) => (
            <line
              key={i}
              x1={(w / 3) * i - 0.1}
              y1={d * 0.62}
              x2={(w / 3) * i + 0.1}
              y2={d * 0.62}
              stroke={INK}
              strokeWidth={LINE}
            />
          ))}
        </g>
      );
    case "wardrobe":
      // Шкаф: створки и штанга пунктиром — так его рисуют на планах.
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} fill={WOOD} {...line} />
          <line x1={w / 2} y1={0} x2={w / 2} y2={d} {...thin} />
          <line
            x1={0.08}
            y1={d * 0.5}
            x2={w - 0.08}
            y2={d * 0.5}
            {...thin}
            strokeDasharray="0.12 0.08"
          />
        </g>
      );
    case "wardrobe-rail":
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} fill={WOOD} {...line} />
          <line
            x1={0.08}
            y1={d * 0.32}
            x2={w - 0.08}
            y2={d * 0.32}
            stroke={INK}
            strokeWidth={LINE}
          />
          {[0.15, 0.32, 0.49, 0.66, 0.83].map((k) => (
            <line key={k} x1={w * k} y1={d * 0.32} x2={w * k} y2={d * 0.82} {...thin} />
          ))}
        </g>
      );

    /* ---------------------------------------------------------------- */
    /* Гостиная                                                          */
    /* ---------------------------------------------------------------- */
    case "sofa": {
      const back = 0.22;
      const arm = 0.18;
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} rx={0.09} fill={SOFT} {...line} />
          {/* Спинка у стены и подлокотники по краям — силуэт узнаётся сразу */}
          <rect
            x={0}
            y={0}
            width={w}
            height={back}
            rx={0.06}
            fill={INK}
            stroke="none"
            opacity={0.75}
          />
          <rect x={0} y={back} width={arm} height={d - back} rx={0.06} {...filled(WHITE)} />
          <rect x={w - arm} y={back} width={arm} height={d - back} rx={0.06} {...filled(WHITE)} />
          {/* Подушки сиденья */}
          {[0, 1, 2].map((i) => {
            const seat = (w - arm * 2) / 3;
            return (
              <rect
                key={i}
                x={arm + seat * i + 0.03}
                y={back + 0.05}
                width={seat - 0.06}
                height={d - back - 0.1}
                rx={0.05}
                {...filled(WHITE)}
              />
            );
          })}
        </g>
      );
    }
    case "armchair":
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} rx={0.12} fill={SOFT} {...line} />
          <rect
            x={0}
            y={0}
            width={w}
            height={0.2}
            rx={0.08}
            fill={INK}
            stroke="none"
            opacity={0.75}
          />
          <rect x={0.1} y={0.24} width={w - 0.2} height={d - 0.32} rx={0.07} {...filled(WHITE)} />
        </g>
      );
    case "coffee-table":
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} rx={0.06} fill={WOOD} {...line} />
          <rect x={0.12} y={0.1} width={w - 0.24} height={d - 0.2} rx={0.04} {...thin} />
        </g>
      );
    case "tv":
      // Панель на стене: тонкая тёмная пластина с кронштейном, без тумбы.
      return (
        <g>
          <rect x={0} y={0} width={w} height={d * 0.55} rx={0.02} fill={INK} stroke="none" />
          <rect
            x={w * 0.42}
            y={d * 0.55}
            width={w * 0.16}
            height={d * 0.45}
            fill={INK}
            stroke="none"
            opacity={0.5}
          />
        </g>
      );
    case "tv-unit":
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} fill={WOOD} {...line} />
          <line x1={0} y1={d / 2} x2={w} y2={d / 2} {...thin} />
          <rect x={w * 0.22} y={-0.05} width={w * 0.56} height={0.05} fill={INK} stroke="none" />
        </g>
      );
    case "shelf":
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} fill={WOOD} {...line} />
          {[0.25, 0.5, 0.75].map((k) => (
            <line key={k} x1={w * k} y1={0} x2={w * k} y2={d} {...thin} />
          ))}
        </g>
      );

    /* ---------------------------------------------------------------- */
    /* Столовая и кухня                                                  */
    /* ---------------------------------------------------------------- */
    case "dining-table":
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} rx={0.05} fill={WOOD} {...line} />
          <rect x={0.1} y={0.1} width={w - 0.2} height={d - 0.2} rx={0.03} {...thin} />
        </g>
      );
    case "round-table":
      return (
        <g>
          <circle cx={w / 2} cy={d / 2} r={Math.min(w, d) / 2} fill={WOOD} {...line} />
          <circle cx={w / 2} cy={d / 2} r={Math.min(w, d) / 2 - 0.1} {...thin} />
        </g>
      );
    case "chair":
      // Стул: сиденье и спинка. Без спинки читался как тумбочка.
      return (
        <g>
          <rect
            x={0.03}
            y={0.08}
            width={w - 0.06}
            height={d - 0.11}
            rx={0.05}
            fill={SOFT}
            {...line}
          />
          <rect
            x={0}
            y={0}
            width={w}
            height={0.08}
            rx={0.03}
            fill={INK}
            stroke="none"
            opacity={0.75}
          />
        </g>
      );
    case "office-chair":
      return (
        <g>
          <circle
            cx={w / 2}
            cy={d / 2 + 0.04}
            r={Math.min(w, d) / 2 - 0.06}
            fill={SOFT}
            {...line}
          />
          <path
            d={`M 0.06 ${d * 0.34} A ${w / 2} ${d / 2} 0 0 1 ${w - 0.06} ${d * 0.34}`}
            {...thin}
            strokeWidth={LINE}
          />
        </g>
      );
    case "kitchen-line": {
      // Кухонная линия: мойка слева, варочная панель справа — как рисуют на
      // планах разобранных проектов.
      const hob = w - 0.72;
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} fill={WHITE} {...line} />
          <line x1={0} y1={d - 0.06} x2={w} y2={d - 0.06} {...thin} />
          <rect x={0.14} y={0.12} width={0.46} height={d - 0.24} rx={0.05} {...thin} />
          <circle cx={0.37} cy={d / 2} r={0.05} fill={INK} stroke="none" />
          <rect x={hob} y={0.1} width={0.58} height={d - 0.2} rx={0.04} {...thin} />
          {[
            [0.16, 0.3],
            [0.42, 0.3],
            [0.16, 0.68],
            [0.42, 0.68],
          ].map(([kx, kz], i) => (
            <circle key={i} cx={hob + 0.58 * (kx / 0.58)} cy={d * kz} r={0.075} {...thin} />
          ))}
        </g>
      );
    }
    case "kitchen-island":
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} rx={0.04} fill={WHITE} {...line} />
          <rect x={0.1} y={0.1} width={w - 0.2} height={d - 0.2} rx={0.03} {...thin} />
          <rect x={w - 0.78} y={0.2} width={0.5} height={d - 0.4} rx={0.05} {...thin} />
          <circle cx={w - 0.53} cy={d / 2} r={0.05} fill={INK} stroke="none" />
        </g>
      );
    case "fridge":
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} rx={0.03} fill={WHITE} {...line} />
          <line x1={0} y1={d * 0.4} x2={w} y2={d * 0.4} {...thin} />
          <line
            x1={w - 0.1}
            y1={d * 0.15}
            x2={w - 0.1}
            y2={d * 0.32}
            stroke={INK}
            strokeWidth={LINE}
          />
          <line
            x1={w - 0.1}
            y1={d * 0.5}
            x2={w - 0.1}
            y2={d * 0.85}
            stroke={INK}
            strokeWidth={LINE}
          />
        </g>
      );

    /* ---------------------------------------------------------------- */
    /* Санузел                                                           */
    /* ---------------------------------------------------------------- */
    case "bath":
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} rx={0.1} fill={WHITE} {...line} />
          <rect x={0.09} y={0.08} width={w - 0.18} height={d - 0.16} rx={0.22} {...thin} />
          <circle cx={w - 0.34} cy={d / 2} r={0.055} fill={INK} stroke="none" />
          <path d={`M 0.16 ${d / 2 - 0.1} l 0 0.2`} stroke={INK} strokeWidth={LINE} />
        </g>
      );
    case "shower":
      // Душ: поддон, трап и штриховка слива.
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} rx={0.04} fill={WHITE} {...line} />
          <circle cx={w / 2} cy={d / 2} r={0.09} {...thin} />
          <line x1={0} y1={0} x2={w} y2={d} {...thin} />
          <line x1={w} y1={0} x2={0} y2={d} {...thin} />
        </g>
      );
    case "toilet":
      return (
        <g>
          <rect x={0.02} y={0} width={w - 0.04} height={0.16} rx={0.03} fill={WHITE} {...line} />
          <ellipse cx={w / 2} cy={d * 0.62} rx={w / 2 - 0.02} ry={d * 0.3} fill={WHITE} {...line} />
          <ellipse cx={w / 2} cy={d * 0.62} rx={w / 2 - 0.09} ry={d * 0.22} {...thin} />
        </g>
      );
    case "sink":
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} rx={0.06} fill={WHITE} {...line} />
          <ellipse cx={w / 2} cy={d * 0.56} rx={w * 0.3} ry={d * 0.3} {...thin} />
          <circle cx={w / 2} cy={0.09} r={0.04} fill={INK} stroke="none" />
        </g>
      );
    case "double-sink":
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} rx={0.06} fill={WHITE} {...line} />
          {[0.27, 0.73].map((k) => (
            <ellipse key={k} cx={w * k} cy={d * 0.56} rx={w * 0.17} ry={d * 0.28} {...thin} />
          ))}
          {[0.27, 0.73].map((k) => (
            <circle key={`t${k}`} cx={w * k} cy={0.09} r={0.04} fill={INK} stroke="none" />
          ))}
        </g>
      );
    case "washer":
    case "dryer":
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} rx={0.03} fill={WHITE} {...line} />
          <circle cx={w / 2} cy={d * 0.55} r={Math.min(w, d) * 0.28} {...thin} strokeWidth={LINE} />
          <circle cx={w / 2} cy={d * 0.55} r={Math.min(w, d) * 0.16} {...thin} />
          <line x1={0.08} y1={0.11} x2={w - 0.08} y2={0.11} {...thin} />
          {kind === "dryer" && (
            <path d={`M ${w * 0.34} 0.06 q 0.08 -0.05 0.16 0 q 0.08 0.05 0.16 0`} {...thin} />
          )}
        </g>
      );
    case "boiler":
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} rx={0.06} fill={WHITE} {...line} />
          <circle cx={w / 2} cy={d * 0.45} r={0.08} {...thin} />
          <line x1={0.1} y1={d - 0.09} x2={w - 0.1} y2={d - 0.09} {...thin} />
        </g>
      );

    /* ---------------------------------------------------------------- */
    /* Кабинет, прихожая, прочее                                         */
    /* ---------------------------------------------------------------- */
    case "desk":
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} rx={0.03} fill={WOOD} {...line} />
          <rect x={w - 0.55} y={0.06} width={0.49} height={d - 0.12} rx={0.03} {...thin} />
          <line x1={w - 0.55} y1={d / 2} x2={w - 0.06} y2={d / 2} {...thin} />
        </g>
      );
    case "shoe-rack":
      // Обувница: три яруса полок.
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} fill={WOOD} {...line} />
          {[0.33, 0.66].map((k) => (
            <line key={k} x1={0} y1={d * k} x2={w} y2={d * k} {...thin} />
          ))}
        </g>
      );
    case "mirror":
      // Зеркало: тонкая пластина у стены с отблеском.
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} fill={WHITE} {...line} />
          <line x1={0.06} y1={d / 2} x2={w - 0.06} y2={d / 2} {...thin} />
        </g>
      );
    case "corner-shower":
      // Угловая кабина: четверть круга со сливом и створками.
      return (
        <g>
          <path d={`M 0 0 L ${w} 0 A ${w} ${d} 0 0 1 0 ${d} Z`} fill={WHITE} {...line} />
          <path d={`M ${w * 0.18} 0 A ${w * 0.82} ${d * 0.82} 0 0 1 0 ${d * 0.82}`} {...thin} />
          <circle cx={w * 0.3} cy={d * 0.3} r={0.075} {...thin} />
          <line x1={w * 0.24} y1={d * 0.24} x2={w * 0.36} y2={d * 0.36} {...thin} />
        </g>
      );
    case "bench":
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} rx={0.05} fill={SOFT} {...line} />
          <rect
            x={0}
            y={0}
            width={w}
            height={0.07}
            rx={0.03}
            fill={INK}
            stroke="none"
            opacity={0.75}
          />
        </g>
      );
    case "plant":
      return (
        <g>
          <circle cx={w / 2} cy={d / 2} r={Math.min(w, d) / 2} fill={LEAF} {...line} />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
            const r = Math.min(w, d) / 2;
            const rad = (a * Math.PI) / 180;
            return (
              <line
                key={a}
                x1={w / 2 + Math.cos(rad) * r * 0.25}
                y1={d / 2 + Math.sin(rad) * r * 0.25}
                x2={w / 2 + Math.cos(rad) * r * 0.92}
                y2={d / 2 + Math.sin(rad) * r * 0.92}
                {...thin}
              />
            );
          })}
          <circle cx={w / 2} cy={d / 2} r={Math.min(w, d) * 0.14} {...filled(WHITE)} />
        </g>
      );
    case "stairs-run": {
      const steps = 9;
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} fill={WHITE} {...line} />
          {Array.from({ length: steps - 1 }, (_, i) => (
            <line
              key={i}
              x1={0}
              y1={(d / steps) * (i + 1)}
              x2={w}
              y2={(d / steps) * (i + 1)}
              {...thin}
            />
          ))}
          <path d={`M ${w / 2} ${d - 0.2} L ${w / 2} 0.2`} {...thin} strokeWidth={LINE} />
          <path
            d={`M ${w / 2 - 0.12} 0.36 L ${w / 2} 0.2 L ${w / 2 + 0.12} 0.36`}
            {...thin}
            strokeWidth={LINE}
          />
        </g>
      );
    }
    case "lounge":
      return (
        <g>
          <rect x={0} y={0} width={w} height={d} rx={0.14} fill={SOFT} {...line} />
          <rect
            x={0}
            y={0}
            width={w}
            height={0.16}
            rx={0.07}
            fill={INK}
            stroke="none"
            opacity={0.75}
          />
          {[0.34, 0.66].map((k) => (
            <line key={k} x1={w * k} y1={0.2} x2={w * k} y2={d - 0.06} {...thin} />
          ))}
        </g>
      );
    case "outdoor-table":
      return (
        <g>
          <circle cx={w / 2} cy={d / 2} r={Math.min(w, d) / 2} fill={WOOD} {...line} />
          <circle cx={w / 2} cy={d / 2} r={Math.min(w, d) / 2 - 0.09} {...thin} />
          <circle cx={w / 2} cy={d / 2} r={0.06} fill={INK} stroke="none" />
        </g>
      );
    default:
      return <rect x={0} y={0} width={w} height={d} fill={WHITE} {...line} />;
  }
}

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
