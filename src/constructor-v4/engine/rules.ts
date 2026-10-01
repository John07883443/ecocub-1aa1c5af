/**
 * Движок правил v4. Принцип владельца (01.10.2026): дом на выходе должен быть
 * близок к реально реализуемому. Поэтому:
 *  - hard — только конструктив из альбома, построенных проектов и решений
 *    владельца. Вариант с нарушением человеку не показывается.
 *  - Где уверенности нет — запрещаем (hard) или помечаем review:
 *    «требует проверки проектировщиком». Разрешать «на всякий случай» нельзя.
 *  - soft/info — объясняют и влияют на оценку варианта.
 */
import { GRAMMAR, roomSpec } from "../grammar/index.ts";
import type { RoomType } from "../grammar/index.ts";
import {
  SIDES,
  area,
  bbox,
  contact,
  exteriorFaces,
  footprint,
  intersect,
  isConnected,
  supportOf,
  uncoveredSegments,
} from "./geometry.ts";
import type { ModulePlacement, Project, Room, RuleResult, Side } from "./types.ts";
import { canPair, factoryModules } from "./factory.ts";
import { checkRoutes, deadEndHalls, doorLanding, kitchenZone } from "./graph.ts";
import { tvPlace } from "./tv.ts";
import { HARMONY, aspectRatio, facadeProfile, fillRatio, outlineCorners } from "./patterns.ts";
import { PILOT } from "../pilot.config.ts";

const SRC_ALBUM = "Альбом Weekend One";
const SRC_OWNER = "Решение владельца 01.10.2026";
const KNOWN_ROOMS = new Set<string>(GRAMMAR.roomTypes.map((r) => r.id));

const fmtM = (mm: number) => (mm / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 2 });

export function modulesOnTier(p: Project, tier: number): ModulePlacement[] {
  return p.modules.filter((m) => m.tier === tier);
}

export function roomOf(p: Project, moduleId: string): Room | undefined {
  return p.rooms.find((r) => r.moduleIds.includes(moduleId));
}

/** Комнаты касаются гранью с контактом ≥ minContact на одном ярусе. */
export function roomsTouch(p: Project, a: Room, b: Room): boolean {
  if (a.tier !== b.tier) return false;
  const ma = p.modules.filter((m) => a.moduleIds.includes(m.id));
  const mb = p.modules.filter((m) => b.moduleIds.includes(m.id));
  return ma.some((x) =>
    mb.some((y) => {
      const c = contact(footprint(x), footprint(y));
      return !!c && c.lengthMm >= GRAMMAR.placement.minContactMm;
    }),
  );
}

/** Грань модуля первого яруса, на которую опирается или через которую свешивается модуль второго. */
export function isLoadedFace(p: Project, m: ModulePlacement, face: Side): boolean {
  if (m.tier !== 1) return false;
  const r = footprint(m);
  return modulesOnTier(p, 2).some((u) => {
    const ur = footprint(u);
    if (!intersect(r, ur)) return false;
    switch (face) {
      case "N":
        return ur.y1 >= r.y1;
      case "S":
        return ur.y0 <= r.y0;
      case "E":
        return ur.x1 >= r.x1;
      case "W":
        return ur.x0 <= r.x0;
    }
  });
}

export function warmContourM2(p: Project): number {
  return p.modules.length * GRAMMAR.module.warmContourAreaM2;
}

/** Площадь помещения в чистоте: 2780 × 3000 на модуль плюс прирост на снятых общих стенах. */
export function roomClearAreaM2(p: Project, room: Room): number {
  const mods = p.modules.filter((m) => room.moduleIds.includes(m.id));
  const shared = GRAMMAR.joints.find((j) => j.id === "shared-wall-210")!;
  let gain = 0;
  for (let i = 0; i < mods.length; i++)
    for (let j = i + 1; j < mods.length; j++) {
      const c = contact(footprint(mods[i]), footprint(mods[j]));
      if (c && c.lengthMm >= GRAMMAR.placement.minContactMm)
        gain += shared.areaGainM2 * Math.min(1, c.lengthMm / GRAMMAR.module.externalMm.d);
    }
  return Math.round((mods.length * GRAMMAR.module.clearAreaM2 + gain) * 100) / 100;
}

type Check = (p: Project) => RuleResult[];

const pass = (
  ruleId: string,
  level: RuleResult["level"],
  message: string,
  source: string,
): RuleResult => ({
  ruleId,
  level,
  ok: true,
  message,
  source,
});
const fail = (
  ruleId: string,
  level: RuleResult["level"],
  message: string,
  source: string,
  subject?: string,
  review?: boolean,
): RuleResult => ({ ruleId, level, ok: false, message, source, subject, review });

// ── Hard ────────────────────────────────────────────────────────────────

const moduleGeometry: Check = (p) => {
  const out: RuleResult[] = [];
  for (const m of p.modules) {
    if (!GRAMMAR.module.rotations.includes(m.rot))
      out.push(
        fail(
          "module-geometry",
          "hard",
          `Модуль ${m.id}: поворот ${m.rot}° не бывает.`,
          SRC_ALBUM,
          m.id,
        ),
      );
    // Привязка — общий шаг 10 мм; шаг сдвига второго яруса (upperSnapMm) применяют команды.
    const snap = GRAMMAR.placement.snapMm;
    if (m.xMm % snap !== 0 || m.yMm % snap !== 0)
      out.push(
        fail(
          "module-geometry",
          "hard",
          `Модуль ${m.id} стоит вне шага привязки ${snap} мм.`,
          SRC_OWNER,
          m.id,
          true,
        ),
      );
  }
  return out.length
    ? out
    : [
        pass(
          "module-geometry",
          "hard",
          "Все модули 3200 × 3420, повороты и шаг верные.",
          SRC_ALBUM,
        ),
      ];
};

const maxTiers: Check = (p) => {
  const bad = p.modules.filter(
    (m) => !Number.isInteger(m.tier) || m.tier < 1 || m.tier > GRAMMAR.tiers.maxTiers,
  );
  return bad.length
    ? [
        fail(
          "max-tiers",
          "hard",
          `Ярусов не больше ${GRAMMAR.tiers.maxTiers}: модули ${bad.map((m) => m.id).join(", ")} на ярусе ${bad[0].tier}. Третий ярус модули не держат по конструктиву.`,
          SRC_OWNER,
          bad[0].id,
        ),
      ]
    : [pass("max-tiers", "hard", "Ярусов не больше двух.", SRC_OWNER)];
};

const noOverlap: Check = (p) => {
  const out: RuleResult[] = [];
  for (let i = 0; i < p.modules.length; i++)
    for (let j = i + 1; j < p.modules.length; j++) {
      const a = p.modules[i];
      const b = p.modules[j];
      if (a.tier === b.tier && intersect(footprint(a), footprint(b)))
        out.push(
          fail("no-overlap", "hard", `Модули ${a.id} и ${b.id} пересекаются.`, SRC_ALBUM, a.id),
        );
    }
  return out.length ? out : [pass("no-overlap", "hard", "Модули не пересекаются.", SRC_ALBUM)];
};

const connected: Check = (p) => {
  const t1 = modulesOnTier(p, 1);
  if (!t1.length)
    return [fail("connected", "hard", "На первом ярусе нет ни одного модуля.", SRC_ALBUM)];
  const out: RuleResult[] = [];
  if (!isConnected(t1))
    out.push(
      fail(
        "connected",
        "hard",
        "Первый ярус распался: каждый модуль должен касаться соседа гранью не меньше 1,5 м (дверь 800 и простенки).",
        SRC_ALBUM,
      ),
    );
  const t2 = modulesOnTier(p, 2);
  if (t2.length && !isConnected(t2))
    out.push(
      fail(
        "connected",
        "hard",
        "Модули второго яруса должны стыковаться друг с другом гранью ≥ 1,5 м.",
        SRC_ALBUM,
      ),
    );
  return out.length
    ? out
    : [pass("connected", "hard", "Дом связный, стыки не короче 1,5 м.", SRC_ALBUM)];
};

const upperSupport: Check = (p) => {
  const t1 = modulesOnTier(p, 1);
  const out: RuleResult[] = [];
  const limit = GRAMMAR.tiers.maxOverhangMm;
  for (const u of modulesOnTier(p, 2)) {
    const s = supportOf(u, t1);
    if (!s.supportedBy.length) {
      out.push(
        fail(
          "upper-support",
          "hard",
          `Модуль ${u.id} второго яруса висит в воздухе.`,
          SRC_OWNER,
          u.id,
        ),
      );
      continue;
    }
    if (!s.continuous)
      out.push(
        fail(
          "upper-support",
          "hard",
          `Модуль ${u.id} перекрывает пустоту между нижними модулями — так завод не делал, не предлагаем.`,
          SRC_OWNER,
          u.id,
          true,
        ),
      );
    if (s.supportFraction < GRAMMAR.tiers.minSupportFraction)
      out.push(
        fail(
          "upper-support",
          "hard",
          `Модуль ${u.id} опирается только на ${Math.round(s.supportFraction * 100)} % площади, нужно не меньше ${Math.round(GRAMMAR.tiers.minSupportFraction * 100)} %.`,
          "Допущение до подтверждения заводом",
          u.id,
          true,
        ),
      );
    for (const side of SIDES) {
      const o = s.overhangMm[side];
      const withColumn = overhangWithColumnMm();
      if (o > limit && withColumn !== null && o <= withColumn) continue; // колонна, см. reviewItems
      if (o > limit) {
        out.push(
          fail(
            "overhang",
            "hard",
            withColumn === null
              ? `Свес ${fmtM(o)} м больше ${fmtM(limit)} м: без колонны так нельзя, а предел с колонной завод пока не подтвердил — такой вариант не предлагаем.`
              : `Свес ${fmtM(o)} м больше ${fmtM(withColumn)} м — так нельзя даже с колонной.`,
            SRC_OWNER,
            u.id,
            true,
          ),
        );
      }
    }
  }
  return out.length
    ? out
    : [
        pass(
          "upper-support",
          "hard",
          "Второй ярус опирается на первый, свес не больше 1,5 м.",
          SRC_OWNER,
        ),
      ];
};

const roomsIntegrity: Check = (p) => {
  const out: RuleResult[] = [];
  for (const m of p.modules) {
    const owners = p.rooms.filter((r) => r.moduleIds.includes(m.id));
    if (owners.length !== 1)
      out.push(
        fail(
          "room-integrity",
          "hard",
          `Модуль ${m.id} должен принадлежать ровно одному помещению.`,
          SRC_ALBUM,
          m.id,
        ),
      );
  }
  for (const r of p.rooms) {
    if (!KNOWN_ROOMS.has(r.type)) {
      out.push(
        fail(
          "room-integrity",
          "hard",
          `Помещения «${r.type}» в наших проектах нет.`,
          SRC_ALBUM,
          r.id,
        ),
      );
      continue;
    }
    const spec = roomSpec(r.type);
    const mods = p.modules.filter((m) => r.moduleIds.includes(m.id));
    if (mods.length < spec.modules.min || mods.length > spec.modules.max)
      out.push(
        fail(
          "room-integrity",
          "hard",
          `${spec.label}: ${mods.length} модул., допустимо ${spec.modules.min}–${spec.modules.max}.`,
          spec.evidence.join(", "),
          r.id,
        ),
      );
    if (mods.some((m) => m.tier !== r.tier))
      out.push(
        fail("room-integrity", "hard", `${spec.label} разорвано между ярусами.`, SRC_ALBUM, r.id),
      );
    if (spec.needs.tier && r.tier !== spec.needs.tier)
      out.push(
        fail(
          "room-integrity",
          "hard",
          `${spec.label} бывает только на ярусе ${spec.needs.tier}.`,
          spec.evidence.join(", "),
          r.id,
        ),
      );
    if (mods.length > 1 && !isConnected(mods))
      out.push(
        fail(
          "room-integrity",
          "hard",
          `${spec.label}: модули должны сливаться через общую стену ≥ 1,5 м.`,
          SRC_ALBUM,
          r.id,
        ),
      );
  }
  if (!p.rooms.some((r) => r.type === "kitchen-living"))
    out.push(
      fail(
        "room-integrity",
        "hard",
        "В доме нет общей комнаты — ядра планировки.",
        "common-room-is-the-core",
      ),
    );
  if (!p.rooms.some((r) => r.type === "wet-core" && r.tier === 1))
    out.push(
      fail(
        "room-integrity",
        "hard",
        "На первом ярусе нужен санузел со стояком.",
        "wet-zone-single-module",
      ),
    );
  return out.length
    ? out
    : [pass("room-integrity", "hard", "Помещения собраны из целых модулей.", SRC_ALBUM)];
};

const adjacency: Check = (p) => {
  const out: RuleResult[] = [];
  for (const r of p.rooms) {
    if (!KNOWN_ROOMS.has(r.type)) continue;
    const spec = roomSpec(r.type);
    const need = spec.needs.adjacentTo;
    if (need?.length) {
      const ok = p.rooms.some((o) => o.id !== r.id && need.includes(o.type) && roomsTouch(p, r, o));
      if (!ok)
        out.push(
          fail(
            "no-corridor",
            "hard",
            `${spec.label} должна открываться прямо в общую комнату или холл — коридоров в наших домах нет.`,
            "no-dedicated-corridor",
            r.id,
          ),
        );
    }
    if (spec.needs.aboveRoom) {
      const t1 = p.rooms.filter((o) => o.type === spec.needs.aboveRoom && o.tier === 1);
      const myMods = p.modules.filter((m) => r.moduleIds.includes(m.id));
      const below = p.modules.filter((m) => t1.some((o) => o.moduleIds.includes(m.id)));
      const ok = myMods.some((m) => below.some((b) => intersect(footprint(m), footprint(b))));
      if (!ok)
        out.push(
          fail(
            "stairs",
            "hard",
            `${spec.label} должен стоять над общей комнатой — оттуда поднимается лестница.`,
            SRC_ALBUM,
            r.id,
          ),
        );
    }
  }
  // Стояк: санузел второго яруса — только над санузлом первого.
  const wet1 = p.modules.filter((m) => roomOf(p, m.id)?.type === "wet-core" && m.tier === 1);
  for (const r of p.rooms.filter((x) => x.type === "wet-core" && x.tier === 2)) {
    const mods = p.modules.filter((m) => r.moduleIds.includes(m.id));
    if (!mods.some((m) => wet1.some((w) => intersect(footprint(m), footprint(w)))))
      out.push(
        fail(
          "riser",
          "hard",
          "Санузел второго яруса должен стоять над санузлом первого: стояк один.",
          "wet-zone-single-module",
          r.id,
        ),
      );
  }
  // Пожилые родители — только 1-й ярус (без лестницы).
  for (const r of p.rooms.filter((x) => x.purpose))
    if (r.tier !== 1)
      out.push(
        fail(
          "elderly-ground-floor",
          "hard",
          "Комната пожилых родителей должна быть на первом ярусе — без лестницы.",
          "Сценарий владельца 01.10.2026",
          r.id,
        ),
      );
  // Второй ярус требует холла с лестницей.
  if (modulesOnTier(p, 2).length && !p.rooms.some((r) => r.type === "hall" && r.tier === 2))
    out.push(fail("stairs", "hard", "На втором ярусе нужен холл с лестницей.", SRC_ALBUM));
  return out.length
    ? out
    : [
        pass(
          "no-corridor",
          "hard",
          "Все помещения открываются в общую комнату или холл.",
          "no-dedicated-corridor",
        ),
      ];
};

const openingsValid: Check = (p) => {
  const out: RuleResult[] = [];
  const pier = GRAMMAR.openings.cornerPierMm;
  for (const o of p.openings) {
    const m = p.modules.find((x) => x.id === o.moduleId);
    if (!m) {
      out.push(fail("openings", "hard", `Проём ${o.id} висит без модуля.`, SRC_ALBUM, o.id));
      continue;
    }
    if (!GRAMMAR.openings.heightsMm.includes(o.heightMm))
      out.push(
        fail(
          "openings",
          "hard",
          `Проём высотой ${o.heightMm} мм не бывает: только 2100, 2500, 2800 или 3150.`,
          "opening-heights",
          o.id,
        ),
      );
    if (
      (o.kind === "entrance" || o.kind === "internal-door") &&
      o.widthMm !== GRAMMAR.openings.door.widthMm &&
      !GRAMMAR.openings.commonDoorWidthsMm.includes(o.widthMm)
    )
      out.push(
        fail(
          "openings",
          "hard",
          `Дверь шириной ${o.widthMm} мм не бывает.`,
          "door-widths-are-discrete",
          o.id,
        ),
      );
    if (o.kind === "internal-door") continue;
    const sameTier = modulesOnTier(p, m.tier);
    const segs = uncoveredSegments(m, o.face, sameTier);
    const r = footprint(m);
    const start = (o.face === "N" || o.face === "S" ? r.x0 : r.y0) + o.offsetMm;
    const end = start + o.widthMm;
    const fits = segs.some(([s0, s1]) => start >= s0 + pier && end <= s1 - pier);
    if (!fits)
      out.push(
        fail(
          "openings",
          "hard",
          `Окно или дверь на грани ${o.face} модуля ${m.id} не помещается: там стык с соседом или не хватает простенка ${pier} мм у угла.`,
          "opening-heights, BASE_MODULE.restriction",
          o.id,
        ),
      );
    if (o.heightMm === 3150 && isLoadedFace(p, m, o.face))
      out.push(
        fail(
          "openings",
          "hard",
          `Панорама в пол на грани ${o.face} модуля ${m.id} невозможна: над ней опирается второй ярус, а у проёма 3150 нет перемычки.`,
          "OPENING_HEIGHTS: headroom 0 у 3150",
          o.id,
          true,
        ),
      );
  }
  const entrances = p.openings.filter((o) => o.kind === "entrance");
  if (!entrances.length)
    out.push(fail("openings", "hard", "У дома нет входной двери.", "entrance-from-terrace"));
  for (const r of p.rooms) {
    if (!KNOWN_ROOMS.has(r.type)) continue;
    const spec = roomSpec(r.type);
    if (spec.needs.window && !p.openings.some((o) => o.roomId === r.id && o.kind === "window"))
      out.push(
        fail(
          "window-required",
          "hard",
          `${spec.label} без окна — так нельзя.`,
          spec.evidence[0],
          r.id,
        ),
      );
  }
  return out.length
    ? out
    : [
        pass(
          "openings",
          "hard",
          "Проёмы только из каталога высот и с простенками у углов.",
          SRC_ALBUM,
        ),
      ];
};

/** Гармония пятна: компактно, без зигзагов, не больше одного уступа на фасад. */
const footprintHarmony: Check = (p) => {
  const out: RuleResult[] = [];
  for (const tier of [1, 2]) {
    const mods = modulesOnTier(p, tier);
    if (mods.length < 2) continue;
    const corners = outlineCorners(mods);
    if (corners > HARMONY.maxCorners)
      out.push(
        fail(
          "footprint-harmony",
          "hard",
          `Ярус ${tier}: контур с ${corners} углами — зигзаг. В наших домах прямоугольник, Г или П (до 8 углов).`,
          "Библиотека форм: Family One/Two, Weekend Mini, Super Family",
        ),
      );
    for (const side of SIDES) {
      const f = facadeProfile(mods, side);
      if (f.steps > HARMONY.maxStepsPerFacade || f.levels > HARMONY.maxLevelsPerFacade) {
        out.push(
          fail(
            "footprint-harmony",
            "hard",
            `Ярус ${tier}, фасад ${side}: ${f.steps} уступа — больше одного выступа или ниши на фасад делает дом рваным.`,
            "Правило ритма фасада (владелец 01.10.2026)",
          ),
        );
        break;
      }
    }
    const ar = aspectRatio(mods);
    // Второй ярус-«брусок» над нижним (CUBAX 57, P10) допускаем до 1:3.
    if (ar > (tier === 2 ? HARMONY.maxAspectUpper : HARMONY.maxAspect))
      out.push(
        fail(
          "footprint-harmony",
          "hard",
          `Ярус ${tier}: пятно вытянуто в ${ar.toFixed(1)} раза — длиннее 1:2,2 не делаем.`,
          "Правило пропорций (владелец 01.10.2026)",
        ),
      );
  }
  return out.length
    ? out
    : [pass("footprint-harmony", "hard", "Пятно компактное, фасады ровные.", "Библиотека форм")];
};

/** Кухня-гостиная не уже двух кубиков (≥ 6,4 м), если дом больше двух кубиков. */
const kitchenWidth: Check = (p) => {
  const k = p.rooms.find((r) => r.type === "kitchen-living");
  if (!k || p.modules.length <= 2) return [];
  const mods = p.modules.filter((m) => k.moduleIds.includes(m.id));
  const wide = mods.some((a) => mods.some((b) => a !== b && canPair(a, b)));
  return [
    wide
      ? pass("kitchen-width", "hard", "Кухня-гостиная шириной от 6,4 м.", "Family Two: 6406 × 6144")
      : fail(
          "kitchen-width",
          "hard",
          "Кухня-гостиная узкая (3,2 м) — коридор, а не комната. Нужны два кубика рядом по длинной стороне (6,4 м).",
          "Family Two: общая комната 6406 × 6144",
          k.id,
        ),
  ];
};

/** У каждой комнаты есть дверь; спальни не проходные. */
const roomDoors: Check = (p) => {
  const out: RuleResult[] = [];
  const hubs = new Set(["kitchen-living", "hall", "corridor"]);
  for (const r of p.rooms) {
    if (hubs.has(r.type)) continue;
    const has = p.openings.some(
      (o) => o.roomId === r.id && (o.kind === "internal-door" || o.kind === "entrance"),
    );
    if (!has)
      out.push(
        fail(
          "room-doors",
          "hard",
          `${roomSpec(r.type).label}: нет двери.`,
          "Планировочные правила",
          r.id,
        ),
      );
  }
  for (const o of p.openings.filter((x) => x.kind === "internal-door")) {
    const m = p.modules.find((x) => x.id === o.moduleId);
    if (!m) continue;
    const behind = p.modules.find((x) => {
      if (x.id === m.id || x.tier !== m.tier) return false;
      const c = contact(footprint(m), footprint(x));
      return !!c && c.faceA === o.face;
    });
    const behindRoom = behind ? roomOf(p, behind.id) : undefined;
    const own = roomOf(p, m.id);
    const kz = own?.type === "bedroom" ? kitchenZone(p) : null;
    if (own && kz && m.tier === 1 && intersect(doorLanding(m, o), kz.zone))
      out.push(
        fail(
          "room-doors",
          "hard",
          "Вход в спальню через кухонную зону: дверь открывается прямо к кухонному фронту. Спальня открывается в холл или в гостиную часть.",
          "Путь человека: улица → прихожая → общая зона → холл → спальни",
          own.id,
        ),
      );
    if (behindRoom?.type === "bedroom" && behindRoom.id !== o.roomId)
      out.push(
        fail(
          "room-doors",
          "hard",
          "Проходная спальня: в неё ведёт дверь из другой комнаты.",
          "Планировочные правила",
          behindRoom.id,
        ),
      );
  }
  return out.length
    ? out
    : [
        pass(
          "room-doors",
          "hard",
          "У каждой комнаты своя дверь, проходных спален нет.",
          "Планировочные правила",
        ),
      ];
};

/** Маршрут: от входа через проёмы доходим до каждой комнаты, в спальню — не через другую спальню. */
const routes: Check = (p) => {
  const r = checkRoutes(p);
  const out: RuleResult[] = [];
  if (!r.entranceRooms.length) return out; // нет входа — ловит правило openings
  for (const id of r.unreachable)
    out.push(
      fail(
        "routes",
        "hard",
        `До помещения ${id} не дойти от входа — нет проёма в стыке.`,
        "Планировочные правила (владелец 01.10.2026)",
        id,
      ),
    );
  for (const id of r.throughBedroom)
    out.push(
      fail(
        "routes",
        "hard",
        `В спальню ${id} можно попасть только через другую спальню.`,
        "Планировочные правила",
        id,
      ),
    );
  return out.length
    ? out
    : [
        pass(
          "routes",
          "hard",
          "От входа через двери доходим до каждой комнаты.",
          "Планировочные правила",
        ),
      ];
};

/** Холл 1-го яруса должен что-то раздавать: вход или хотя бы одну комнату. Тупиковый холл — лишний кубик. */
const hallHasPurpose: Check = (p) => {
  const halls = p.rooms.filter((r) => r.type === "corridor");
  if (!halls.length) return [];
  const dead = new Set(deadEndHalls(p).map((r) => r.id));
  const out: RuleResult[] = [];
  for (const h of halls)
    if (dead.has(h.id))
      out.push(
        fail(
          "hall-purpose",
          "hard",
          "Холл в тупике: через него не входят и в него не открывается ни одна комната — лишний кубик. Отдайте его спальне под гардеробную или уберите.",
          "Владелец 01.10.2026: «Холл в конце без назначения»",
          h.id,
        ),
      );
  return out.length
    ? out
    : [pass("hall-purpose", "hard", "Холл раздаёт комнаты или встречает у входа.", SRC_ALBUM)];
};

/** Место под телевизор в общей комнате (владелец 01.10.2026). */
const tvWall: Check = (p) => {
  if (!p.rooms.some((r) => r.type === "kitchen-living")) return [];
  const t = tvPlace(p);
  return [
    t
      ? pass(
          "tv-wall",
          "hard",
          `Место под ТВ: глухая стена ${((t.wall[1] - t.wall[0]) / 1000).toFixed(1)} м, до дивана ${(t.viewingMm / 1000).toFixed(1)} м${t.interior ? ", внутренняя стена" : ""}.`,
          "Владелец 01.10.2026: «без телевизора сейчас никак»",
        )
      : fail(
          "tv-wall",
          "hard",
          "В общей комнате нет места под телевизор: нужна глухая стена от 2,4 м, диван в 2,5–3,5 м напротив и без панорамы за спиной.",
          "Владелец 01.10.2026: «без телевизора сейчас никак»",
        ),
  ];
};

/** Ночная зона собрана: спальни первого яруса по одну сторону общей комнаты (на больших домах — крылья). */
/** Компактность и пропорции (мировая практика): заполнение ≥ 75 % (≥ 80 % до 6 кубиков) — жёстко, пропорции до 1:2,2 — мягко. */
const footprintCompact: Check = (p) => {
  const out: RuleResult[] = [];
  for (const tier of [1, 2]) {
    const mods = modulesOnTier(p, tier);
    if (mods.length < 3) continue;
    const fill = fillRatio(mods);
    const need = mods.length <= 6 ? 0.8 : HARMONY.minFill;
    out.push(
      fill >= need - 1e-9
        ? pass(
            "footprint-fill",
            "hard",
            `Ярус ${tier}: пятно заполнено на ${Math.round(fill * 100)} %.`,
            "ARCHITECT_KNOWLEDGE_WORLD, правило A1",
          )
        : fail(
            "footprint-fill",
            "hard",
            `Ярус ${tier}: пятно заполнено на ${Math.round(fill * 100)} % — меньше ${Math.round(need * 100)} %, слишком много уступов.`,
            "ARCHITECT_KNOWLEDGE_WORLD, правило A1",
          ),
    );
  }
  const t1 = modulesOnTier(p, 1);
  if (t1.length >= 3) {
    const ar = aspectRatio(t1);
    out.push(
      ar <= HARMONY.preferredAspect
        ? pass(
            "footprint-aspect",
            "soft",
            "Пропорции пятна спокойные (до 1:2,2).",
            "ARCHITECT_KNOWLEDGE_WORLD, правило A3",
          )
        : fail(
            "footprint-aspect",
            "soft",
            `Дом вытянут 1:${ar.toFixed(1)} — длинный дом теряет тепло и выглядит как вагон.`,
            "ARCHITECT_KNOWLEDGE_WORLD, правило A3",
          ),
    );
  }
  return out;
};

/** Мокрые зоны одной группой на ярусе (CUBAX: один стояк, кубики спиной к спине). */
const wetGrouped: Check = (p) => {
  const out: RuleResult[] = [];
  for (const tier of [1, 2]) {
    const wet = p.modules.filter((m) => m.tier === tier && roomOf(p, m.id)?.type === "wet-core");
    if (wet.length < 2) continue;
    const ok = isConnected(wet, 1);
    out.push(
      ok
        ? pass(
            "wet-grouped",
            "soft",
            `Ярус ${tier}: санузлы рядом — один стояк.`,
            "LAYOUT_PATTERNS_CUBAX, п. 3.4",
          )
        : fail(
            "wet-grouped",
            "soft",
            `Ярус ${tier}: санузлы разбросаны — два стояка, дороже инженерия.`,
            "LAYOUT_PATTERNS_CUBAX, п. 3.4",
          ),
    );
  }
  return out;
};

/** Коридоры не больше 12 % площади (CUBAX, мировая практика). */
const corridorShare: Check = (p) => {
  const c = p.rooms
    .filter((r) => r.type === "corridor")
    .reduce((s, r) => s + r.moduleIds.length, 0);
  if (!c) return [];
  const share = c / p.modules.length;
  return [
    share <= 0.12
      ? pass(
          "corridor-share",
          "soft",
          `Холл занимает ${Math.round(share * 100)} % — коротко.`,
          "ARCHITECT_KNOWLEDGE_WORLD, правило B10",
        )
      : fail(
          "corridor-share",
          "soft",
          `Холл занимает ${Math.round(share * 100)} % — больше 12 %, площадь уходит в проход.`,
          "ARCHITECT_KNOWLEDGE_WORLD, правило B10",
        ),
  ];
};

const nightZone: Check = (p) => {
  const k = p.rooms.find((r) => r.type === "kitchen-living");
  const beds = p.rooms.filter((r) => r.type === "bedroom" && r.tier === 1);
  if (!k || beds.length < 2 || warmContourM2(p) >= 90) return [];
  const kx = p.modules
    .filter((m) => k.moduleIds.includes(m.id))
    .map((m) => (footprint(m).x0 + footprint(m).x1) / 2);
  const kc = kx.reduce((a, b) => a + b, 0) / kx.length;
  const sides = new Set(
    beds.map((b) => {
      const r = footprint(p.modules.find((m) => m.id === b.moduleIds[0])!);
      return (r.x0 + r.x1) / 2 < kc ? "L" : "R";
    }),
  );
  return [
    sides.size === 1
      ? pass("night-zone", "soft", "Спальни собраны в ночную зону.", "Зонирование день/ночь")
      : fail(
          "night-zone",
          "soft",
          "Спальни по разные стороны общей комнаты — ночная зона разорвана.",
          "Зонирование день/ночь",
        ),
  ];
};

const plotFit: Check = (p) => {
  if (!p.plot)
    return [pass("plot-fit", "info", "Участок не задан — посадку проверит проектировщик.", "—")];
  const sb = p.plot.setbackMm ?? GRAMMAR.site.setbackMm;
  const b = bbox(p.modules.map(footprint));
  const x0 = p.placementMm.xMm + b.x0;
  const y0 = p.placementMm.yMm + b.y0;
  const x1 = p.placementMm.xMm + b.x1;
  const y1 = p.placementMm.yMm + b.y1;
  const W = p.plot.widthM * 1000;
  const D = p.plot.depthM * 1000;
  if (x0 < sb || y0 < sb || x1 > W - sb || y1 > D - sb)
    return [
      fail(
        "plot-fit",
        "hard",
        `Дом ${fmtM(b.x1 - b.x0)} × ${fmtM(b.y1 - b.y0)} м не встаёт на участок ${p.plot.widthM} × ${p.plot.depthM} м с отступом ${fmtM(sb)} м.`,
        "Отступ 3 м — предварительно",
      ),
    ];
  return [
    pass("plot-fit", "hard", "Дом встаёт на участок с отступами.", "Отступ 3 м — предварительно"),
  ];
};

// ── Soft ────────────────────────────────────────────────────────────────

const bedroomsInCorners: Check = (p) => {
  const out: RuleResult[] = [];
  for (const r of p.rooms.filter((x) => x.type === "bedroom")) {
    const m = p.modules.find((x) => x.id === r.moduleIds[0]);
    if (!m) continue;
    const n = exteriorFaces(m, modulesOnTier(p, m.tier)).length;
    out.push(
      n >= 2
        ? pass(
            "bedrooms-in-corners",
            "soft",
            "Спальня угловая: две наружные стены, свет с двух сторон.",
            "Family One, Family Two",
          )
        : fail(
            "bedrooms-in-corners",
            "soft",
            "Спальня с одной наружной стеной: темнее и без сквозного проветривания.",
            "Family One, Family Two",
            r.id,
          ),
    );
  }
  return out;
};

export function expectedBathrooms(warmM2: number): number {
  return warmM2 < 85 ? 1 : warmM2 < 125 ? 2 : 3;
}

const bathroomsScale: Check = (p) => {
  const warm = warmContourM2(p);
  const n = p.rooms.filter((r) => r.type === "wet-core").length;
  const exp = expectedBathrooms(warm);
  return [
    n >= exp
      ? pass(
          "bathrooms-scale-with-size",
          "soft",
          `Санузлов ${n} на ${Math.round(warm)} м² — как в наших проектах.`,
          "bathrooms-scale-with-size",
        )
      : fail(
          "bathrooms-scale-with-size",
          "soft",
          `На ${Math.round(warm)} м² в наших проектах ${exp} санузла, здесь ${n}: утром будет очередь.`,
          "bathrooms-scale-with-size",
        ),
  ];
};

const terraceLarge: Check = (p) => {
  const warm = warmContourM2(p);
  return [
    p.terrace.totalM2 >= 0.6 * warm
      ? pass(
          "terrace-is-large",
          "soft",
          "Терраса не меньше 60 % дома — как в построенных.",
          "terrace-is-large",
        )
      : fail(
          "terrace-is-large",
          "soft",
          "Терраса меньше 60 % дома: в наших проектах она больше.",
          "terrace-is-large",
        ),
  ];
};

const preferredOffsets: Check = (p) => {
  const t1 = modulesOnTier(p, 1);
  let odd = 0;
  for (let i = 0; i < t1.length; i++)
    for (let j = i + 1; j < t1.length; j++) {
      const c = contact(footprint(t1[i]), footprint(t1[j]));
      if (c && !GRAMMAR.placement.preferredOffsetsMm.includes(c.offsetMm)) odd++;
    }
  return [
    odd === 0
      ? pass(
          "preferred-offsets",
          "soft",
          "Смещения модулей 0 или 1710 — как на заводе.",
          "half-depth-offset",
        )
      : fail(
          "preferred-offsets",
          "soft",
          `Стыков с нестандартным смещением: ${odd}. Возможно, но проектировщик проверит.`,
          "half-depth-offset",
          undefined,
          true,
        ),
  ];
};

/** Сторона света по грани с учётом поворота участка. */
export function compassOf(face: Side, northDeg = 0): Side {
  const idx = (SIDES.indexOf(face) * 90 - northDeg + 360 * 4) % 360;
  return SIDES[Math.round(idx / 90) % 4];
}

const livingFacesSouth: Check = (p) => {
  if (p.plot?.northDeg === undefined)
    return [pass("living-faces-south", "info", "Стороны света не заданы.", "—")];
  const kitchen = p.rooms.find((r) => r.type === "kitchen-living");
  const south = p.openings.some(
    (o) =>
      o.roomId === kitchen?.id &&
      o.kind === "window" &&
      ["S", "W"].includes(compassOf(o.face, p.plot!.northDeg)),
  );
  return [
    south
      ? pass(
          "living-faces-south",
          "soft",
          "Панорама общей комнаты смотрит на юг или запад — вечернее солнце.",
          "Инсоляция",
        )
      : fail(
          "living-faces-south",
          "soft",
          "Панорама общей комнаты смотрит на север или восток — днём темнее.",
          "Инсоляция",
        ),
  ];
};

const compactFootprint: Check = (p) => {
  const t1 = modulesOnTier(p, 1);
  if (!t1.length) return [];
  const b = bbox(t1.map(footprint));
  const ratio = (t1.length * area(footprint(t1[0]))) / area(b);
  return [
    ratio >= 0.5
      ? pass("compact-footprint", "soft", "Пятно застройки компактное.", "Экономика фундамента")
      : fail(
          "compact-footprint",
          "soft",
          "Пятно застройки разбросано: фундамент и кровля дороже.",
          "Экономика фундамента",
        ),
  ];
};

// ── Info / review ───────────────────────────────────────────────────────

const cubesPairIntoModules: Check = (p) => {
  const fm = factoryModules(p);
  return [
    fm.unpairedCubeIds.length === 0
      ? pass(
          "cubes-pair-into-modules",
          "soft",
          `${fm.cubes} кубиков собираются в ${fm.modules.length} заводских модулей по 2.`,
          SRC_OWNER,
        )
      : fail(
          "cubes-pair-into-modules",
          "soft",
          `Кубик ${fm.unpairedCubeIds.join(", ")} без пары: завод делает модули по 2 кубика — требует проверки проектировщиком; в цене считаем как полмодуля (допущение).`,
          SRC_OWNER,
          fm.unpairedCubeIds[0],
          true,
        ),
  ];
};

/** Предел свеса с колонной: черновик пилота (3 м), пока завод не назвал своё. */
export function overhangWithColumnMm(): number | null {
  return PILOT.structure.overhangWithColumnMm ?? GRAMMAR.tiers.overhangWithColumnMm;
}

/** Сколько колонн нужно под свесами больше 1,5 м. */
export function columnsFor(p: Project): number {
  const t1 = modulesOnTier(p, 1);
  let n = 0;
  for (const u of modulesOnTier(p, 2)) {
    const s = supportOf(u, t1);
    for (const side of SIDES)
      if (
        s.overhangMm[side] > GRAMMAR.tiers.maxOverhangMm ||
        (s.overhangMm[side] > 0 && p.overhangSupports?.includes(side))
      )
        n += PILOT.structure.columnsPerOverhangSide;
  }
  return n;
}

const elderlyNearBath: Check = (p) => {
  const wet = p.rooms.filter((r) => r.type === "wet-core" && r.tier === 1);
  return p.rooms
    .filter((r) => r.purpose === "elderly")
    .map((r) =>
      wet.some((w) => roomsTouch(p, r, w))
        ? pass(
            "elderly-near-bath",
            "soft",
            "У спальни родителей свой санузел рядом.",
            "Сценарий владельца",
          )
        : fail(
            "elderly-near-bath",
            "soft",
            "Санузел далеко от спальни родителей — ночью идти через общую комнату.",
            "Сценарий владельца",
            r.id,
          ),
    );
};

const reviewItems: Check = (p) => {
  const out: RuleResult[] = [];
  const cols = columnsFor(p);
  if (cols)
    out.push({
      ...pass(
        "column-review",
        "info",
        `Свес больше 1,5 м — под ним ${cols} колонн(ы). Предел 3 м и колонна — черновик, проверяет проектировщик.`,
        "Черновик пилота 01.10.2026",
      ),
      review: true,
    });
  if (modulesOnTier(p, 2).length) {
    out.push({
      ...pass(
        "stairs-review",
        "info",
        `Лестница на второй ярус: ${PILOT.structure.stairType} (черновик), габарит уточняет проектировщик.`,
        SRC_ALBUM,
      ),
      review: true,
    });
    const t1 = modulesOnTier(p, 1);
    const maxO = Math.max(
      ...modulesOnTier(p, 2).map((u) => Math.max(...Object.values(supportOf(u, t1).overhangMm))),
    );
    if (maxO > 0)
      out.push({
        ...pass(
          "overhang-review",
          "info",
          `Свес второго яруса до ${fmtM(maxO)} м без колонны — в пределе 1,5 м, расчёт делает проектировщик.`,
          SRC_OWNER,
        ),
        review: true,
      });
  }
  return out;
};

export const HARD_CHECKS: Check[] = [
  moduleGeometry,
  maxTiers,
  noOverlap,
  connected,
  upperSupport,
  roomsIntegrity,
  adjacency,
  openingsValid,
  plotFit,
  footprintHarmony,
  kitchenWidth,
  roomDoors,
  footprintCompact,
  routes,
  tvWall,
  hallHasPurpose,
];
export const SOFT_CHECKS: Check[] = [
  bedroomsInCorners,
  bathroomsScale,
  terraceLarge,
  preferredOffsets,
  livingFacesSouth,
  compactFootprint,
  cubesPairIntoModules,
  elderlyNearBath,
  nightZone,
  wetGrouped,
  corridorShare,
  reviewItems,
];

export interface Evaluation {
  results: RuleResult[];
  hardViolations: RuleResult[];
  valid: boolean;
  /** 0..1 — доля выполненных мягких правил с весами грамматики. */
  softScore: number;
  review: RuleResult[];
}

export function evaluate(p: Project): Evaluation {
  const results = [...HARD_CHECKS, ...SOFT_CHECKS].flatMap((c) => c(p));
  const hardViolations = results.filter((r) => r.level === "hard" && !r.ok);
  const weights = new Map(GRAMMAR.softRules.map((r) => [r.id, r.weight]));
  const soft = results.filter((r) => r.level === "soft");
  const total = soft.reduce((s, r) => s + (weights.get(r.ruleId) ?? 1), 0);
  const got = soft.filter((r) => r.ok).reduce((s, r) => s + (weights.get(r.ruleId) ?? 1), 0);
  return {
    results,
    hardViolations,
    valid: hardViolations.length === 0,
    softScore: total ? got / total : 1,
    review: results.filter((r) => r.review),
  };
}

/** Короткое объяснение для архитектора-ассистента: что нарушено и почему. */
export function explain(e: Evaluation): string[] {
  return e.hardViolations.length
    ? e.hardViolations.map((r) => r.message)
    : e.results.filter((r) => r.level === "soft" && !r.ok).map((r) => r.message);
}

export type { RoomType };
