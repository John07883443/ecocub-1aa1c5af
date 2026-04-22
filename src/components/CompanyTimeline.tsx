const milestones = [
  {
    year: "2021",
    title: "Основание",
    desc: "Запуск производства первых модульных бетонных домов в Подмосковье",
  },
  {
    year: "2023",
    title: "12 патентов",
    desc: "Регистрация технологии монолитно-модульной сборки и собственных конструктивных решений",
  },
  {
    year: "2025",
    title: "300+ модулей",
    desc: "Выпущено более 300 модулей. В команде 50 специалистов, своё производство в МО",
  },
];

export function CompanyTimeline() {
  return (
    <div className="grid gap-10 md:grid-cols-3">
      {milestones.map((m, i) => (
        <div key={m.year} className="relative">
          <div className="text-xs font-medium uppercase tracking-[0.3em] text-accent">
            {String(i + 1).padStart(2, "0")}
          </div>
          <div className="mt-3 text-5xl font-bold md:text-6xl">{m.year}</div>
          <div className="mt-4 h-px w-12 bg-accent" />
          <h3 className="mt-4 text-xl font-semibold uppercase">{m.title}</h3>
          <p className="mt-3 text-sm text-muted-foreground">{m.desc}</p>
        </div>
      ))}
    </div>
  );
}
