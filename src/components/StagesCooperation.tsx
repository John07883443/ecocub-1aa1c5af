const stages = [
  {
    n: "01",
    title: "Заявка и встреча",
    desc: "Знакомимся, обсуждаем участок, выбираем проект или дорабатываем под вас",
    payment: null,
  },
  {
    n: "02",
    title: "Договор и предоплата",
    desc: "Фиксируем смету, подписываем договор, запускаем производство модулей",
    payment: "60%",
  },
  {
    n: "03",
    title: "Производство и фундамент",
    desc: "На заводе делаем модули, на участке — фундамент. Параллельно, до 90 дней",
    payment: null,
  },
  {
    n: "04",
    title: "Доставка и монтаж",
    desc: "Привозим модули на участок, собираем дом краном за 10 дней",
    payment: "30%",
  },
  {
    n: "05",
    title: "Сдача под ключ",
    desc: "Подключаем коммуникации, передаём документы, выдаём гарантию 50 лет",
    payment: "10%",
  },
];

export function StagesCooperation() {
  return (
    <div className="grid gap-6 md:grid-cols-5">
      {stages.map((s) => (
        <div
          key={s.n}
          className="flex flex-col rounded-sm border border-border bg-card p-6"
        >
          <div className="text-3xl font-bold text-accent">{s.n}</div>
          <h3 className="mt-3 text-base font-semibold uppercase">{s.title}</h3>
          <p className="mt-2 flex-1 text-sm text-muted-foreground">{s.desc}</p>
          {s.payment && (
            <div className="mt-4 inline-flex w-fit rounded-sm bg-accent/10 px-3 py-1 text-sm font-semibold text-accent">
              Оплата {s.payment}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
