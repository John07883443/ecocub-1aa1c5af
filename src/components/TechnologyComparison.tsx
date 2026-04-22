import { Check, X, Minus } from "lucide-react";

type Cell = string | "yes" | "no" | "partial";

const headers = ["Параметр", "ECO·CUB", "Кирпич", "Газобетон", "Монолит", "ЖБИ-панели"];

const rows: Cell[][] = [
  ["Срок строительства", "90 дней", "12–18 мес", "8–12 мес", "6–10 мес", "6–9 мес"],
  ["Цена за м² (предчист.)", "от 105 000 ₽", "90–130 тыс ₽", "70–100 тыс ₽", "100–150 тыс ₽", "130–180 тыс ₽"],
  ["Зависимость от погоды", "no", "yes", "yes", "yes", "partial"],
  ["Заводское качество", "yes", "no", "no", "no", "yes"],
  ["Срок службы", ">120 лет", "100+ лет", "50–70 лет", "100+ лет", "80–100 лет"],
  ["Усадка", "Нет", "Минимальная", "Есть", "Есть", "Нет"],
  ["Гарантия", "50 лет", "от подрядчика", "от подрядчика", "от подрядчика", "25–30 лет"],
  ["Фиксированная смета", "yes", "no", "no", "no", "partial"],
  ["Готовая инженерия", "yes", "no", "no", "no", "partial"],
];

function renderCell(c: Cell, isHighlight: boolean) {
  const base = isHighlight ? "font-semibold text-accent" : "text-foreground";
  if (c === "yes") return <Check className={`mx-auto size-5 ${isHighlight ? "text-accent" : "text-emerald-600"}`} />;
  if (c === "no") return <X className="mx-auto size-5 text-destructive/70" />;
  if (c === "partial") return <Minus className="mx-auto size-5 text-muted-foreground" />;
  return <span className={base}>{c}</span>;
}

export function TechnologyComparison() {
  return (
    <div className="overflow-x-auto rounded-sm border border-border">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="bg-primary text-primary-foreground">
            {headers.map((h, i) => (
              <th
                key={h}
                className={`px-4 py-4 text-left text-xs font-semibold uppercase tracking-wider ${
                  i === 1 ? "bg-accent text-accent-foreground" : ""
                }`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr
              key={ri}
              className={`border-t border-border ${ri % 2 === 0 ? "bg-background" : "bg-secondary/40"}`}
            >
              {row.map((c, ci) => (
                <td
                  key={ci}
                  className={`px-4 py-3 ${ci === 0 ? "font-medium" : "text-center"} ${
                    ci === 1 ? "bg-accent/5" : ""
                  }`}
                >
                  {ci === 0 ? <span>{c as string}</span> : renderCell(c, ci === 1)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
