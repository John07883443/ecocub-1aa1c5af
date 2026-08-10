import { MODULE_SIDE_M } from "../constructor/constants.ts";
import type { ModuleItem } from "../constructor/types.ts";
import { computeJoints, deriveOpenings, roomHasRoute } from "./rooms.ts";
import { bathroomCount, bedroomCount } from "./program.ts";
import { houseFromModules } from "./zoning.ts";
import type { HouseState, RoomType } from "./types.ts";

/**
 * Проверка планировки на здравый смысл.
 *
 * Правила планировщика проверять поштучно бессмысленно: каждый дефект,
 * который мы находили, вылезал не в отдельной функции, а на стыке правил —
 * правило одной двери замуровало кухню, выбор санузла разорвал общую зону.
 * Ловить такое можно только на готовом результате.
 *
 * Здесь собраны инварианты: утверждения, которые обязаны выполняться для
 * ЛЮБОГО дома, как бы человек ни сложил кубики. Прогон по сотням форм ищет
 * контрпример; найденный контрпример становится тестом, а правило —
 * поправкой. Так конструктор и тренируется.
 *
 * Тот же аудит стережёт предложения нейросети: что не прошло проверку, то не
 * показывается человеку, чем бы модель это ни обосновала.
 */

export type Severity = "error" | "warning";

export interface Finding {
  code: string;
  severity: Severity;
  message: string;
  roomId?: string;
}

/** Инвариант: описание и проверка. */
interface Invariant {
  code: string;
  severity: Severity;
  check: (house: HouseState) => Finding[];
}

const PRIVATE: RoomType[] = ["bedroom", "bathroom", "storage", "office"];

const INVARIANTS: Invariant[] = [
  {
    code: "no-entrance",
    severity: "error",
    check: (house) => {
      const entries = deriveOpenings(house, 0).filter((o) => o.kind === "entry");
      if (entries.length === 1) return [];
      return [
        {
          code: "no-entrance",
          severity: "error",
          message:
            entries.length === 0 ? "В дом негде войти: входной двери нет" : "Входов больше одного",
        },
      ];
    },
  },
  {
    code: "sealed-room",
    severity: "error",
    check: (house) =>
      house.rooms
        .filter((r) => !roomHasRoute(house, r.id))
        .map((r) => ({
          code: "sealed-room",
          severity: "error" as const,
          message: `В помещение «${r.type}» нельзя попасть`,
          roomId: r.id,
        })),
  },
  {
    code: "split-public",
    severity: "error",
    check: (house) => {
      const publicRooms = house.rooms.filter((r) => r.type === "living" || r.type === "kitchen");
      const modules = house.modules.filter((m) => publicRooms.some((r) => r.id === m.roomId));
      if (modules.length <= 1) return [];
      const seen = new Set([modules[0].id]);
      const queue = [modules[0]];
      while (queue.length) {
        const cur = queue.shift()!;
        for (const m of modules) {
          if (seen.has(m.id) || !touches(cur, m)) continue;
          seen.add(m.id);
          queue.push(m);
        }
      }
      if (seen.size === modules.length) return [];
      return [
        {
          code: "split-public",
          severity: "error",
          message: "Общая зона разорвана на части",
        },
      ];
    },
  },
  {
    code: "empty-room",
    severity: "error",
    // Терраса и холл могут стоять пустыми законно: лежаку нужна свободная
    // грань, а коридор мебелью и не заставляют. Для жилых комнат пустота —
    // ошибка: спальня без кровати не планировка.
    check: (house) =>
      house.rooms
        .filter(
          (r) =>
            r.type !== "terrace" &&
            r.type !== "entryway" &&
            !(house.layouts[r.id]?.items ?? []).length,
        )
        .map((r) => ({
          code: "empty-room",
          severity: "error" as const,
          message: `В помещении «${r.type}» не поместилась мебель`,
          roomId: r.id,
        })),
  },
  {
    code: "bedroom-without-window",
    severity: "warning",
    check: (house) => {
      const windows = deriveOpenings(house, 0).filter((o) => o.kind === "window");
      return house.rooms
        .filter((r) => r.type === "bedroom")
        .filter((r) => !windows.some((w) => w.id.includes(r.id)))
        .map((r) => ({
          code: "bedroom-without-window",
          severity: "warning" as const,
          message: "Спальня без окна",
          roomId: r.id,
        }));
    },
  },
  {
    code: "private-room-overconnected",
    severity: "warning",
    check: (house) => {
      const joints = computeJoints(house);
      return house.rooms
        .filter((r) => PRIVATE.includes(r.type))
        .flatMap((r) => {
          const ids = new Set(r.moduleIds);
          const doors = joints.filter(
            (j) =>
              ids.has(j.aId) !== ids.has(j.bId) && j.state !== "closed" && j.state !== "unknown",
          );
          if (doors.length <= 1) return [];
          return [
            {
              code: "private-room-overconnected",
              severity: "warning" as const,
              message: `У помещения «${r.type}» ${doors.length} входа вместо одного`,
              roomId: r.id,
            },
          ];
        });
    },
  },
  {
    code: "program-mismatch",
    severity: "warning",
    check: (house) => {
      const heated = house.modules.filter((m) => {
        const room = house.rooms.find((r) => r.id === m.roomId);
        return room && room.type !== "terrace";
      }).length;
      if (heated < 3) return [];
      const out: Finding[] = [];
      const beds = house.rooms.filter((r) => r.type === "bedroom").length;
      const baths = house.rooms.filter((r) => r.type === "bathroom").length;
      if (beds !== bedroomCount(heated)) {
        out.push({
          code: "program-mismatch",
          severity: "warning",
          message: `Спален ${beds}, по стандарту для ${heated} модулей ожидается ${bedroomCount(heated)}`,
        });
      }
      if (baths !== bathroomCount(heated)) {
        out.push({
          code: "program-mismatch",
          severity: "warning",
          message: `Санузлов ${baths}, по стандарту ожидается ${bathroomCount(heated)}`,
        });
      }
      return out;
    },
  },
  {
    code: "no-common-room",
    severity: "error",
    check: (house) => {
      const heated = house.rooms.filter((r) => r.type !== "terrace");
      if (heated.length <= 1) return [];
      const hasCommon = heated.some((r) => r.type === "living" || r.type === "kitchen");
      return hasCommon
        ? []
        : [{ code: "no-common-room", severity: "error", message: "В доме нет общей зоны" }];
    },
  },
];

/** Проверить готовый дом. Пустой список — планировка выдержала все инварианты. */
export function auditHouse(house: HouseState): Finding[] {
  return INVARIANTS.flatMap((inv) => inv.check(house));
}

/** Проверить набор кубиков: удобная обёртка для прогонов и для UI. */
export function auditModules(modules: ModuleItem[]): Finding[] {
  return auditHouse(houseFromModules(modules));
}

/** Только то, что нельзя показывать человеку. */
export function errors(findings: Finding[]): Finding[] {
  return findings.filter((f) => f.severity === "error");
}

function touches(a: { x: number; z: number }, b: { x: number; z: number }): boolean {
  return (
    (Math.abs(a.x - b.x) === MODULE_SIDE_M && Math.abs(a.z - b.z) < MODULE_SIDE_M) ||
    (Math.abs(a.z - b.z) === MODULE_SIDE_M && Math.abs(a.x - b.x) < MODULE_SIDE_M)
  );
}
