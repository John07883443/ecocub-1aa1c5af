#!/usr/bin/env node
/**
 * Выгрузка заявок в CSV. Запускать на сервере, где лежит база:
 *
 *   node scripts/leads-export.mjs > leads.csv
 *   node scripts/leads-export.mjs --path /var/lib/ecocub/leads.db > leads.csv
 *
 * Читает оба возможных хранилища: SQLite (основное) и соседний .jsonl
 * (запасное, если на сервере Node старше 22.5 и node:sqlite недоступен).
 * Записи объединяются и сортируются по дате.
 *
 * CSV с BOM — иначе Excel открывает кириллицу кракозябрами.
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

// node:sqlite подключаем через require: на версиях Node, где модуля нет,
// статический import уронил бы весь скрипт, а нам нужно дочитать JSONL.
const require = createRequire(import.meta.url);

const argPath = process.argv.indexOf("--path");
const DB_PATH =
  (argPath !== -1 ? process.argv[argPath + 1] : null) ||
  process.env.LEADS_DB_PATH ||
  "/var/lib/ecocub/leads.db";
const JSONL_PATH = DB_PATH.replace(/\.db$/, "") + ".jsonl";

const COLUMNS = [
  "created_at",
  "form_type",
  "name",
  "phone",
  "email",
  "message",
  "project_slug",
  "source_page",
  "status",
  "payload",
];

function fromSqlite() {
  if (!existsSync(DB_PATH)) return [];
  try {
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    return db.prepare(`SELECT ${COLUMNS.join(",")} FROM leads`).all();
  } catch (e) {
    process.stderr.write(`SQLite не прочитан (${e.message})\n`);
    return [];
  }
}

function fromJsonl() {
  if (!existsSync(JSONL_PATH)) return [];
  return readFileSync(JSONL_PATH, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      try {
        const r = JSON.parse(line);
        // В JSONL поля названы как в коде, в SQLite — как в схеме. Приводим к схеме.
        return {
          created_at: r.createdAt,
          form_type: r.formType,
          name: r.name,
          phone: r.phone,
          email: r.email,
          message: r.message,
          project_slug: r.projectSlug,
          source_page: r.sourcePage,
          status: "new",
          payload: r.payload,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

const cell = (v) => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const rows = [...fromSqlite(), ...fromJsonl()].sort((a, b) =>
  String(a.created_at).localeCompare(String(b.created_at)),
);

if (!rows.length) {
  process.stderr.write(`Заявок не найдено. Искал: ${DB_PATH} и ${JSONL_PATH}\n`);
}

// Разделитель ; — русская локаль Excel ждёт именно его.
const lines = [COLUMNS.join(";"), ...rows.map((r) => COLUMNS.map((c) => cell(r[c])).join(";"))];
process.stdout.write("﻿" + lines.join("\n") + "\n");
process.stderr.write(`Выгружено заявок: ${rows.length}\n`);
