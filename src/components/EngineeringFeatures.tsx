import { Thermometer, Wind, Cpu, Zap, PanelsTopLeft } from "lucide-react";

const features = [
  {
    icon: Thermometer,
    title: "Тёплый пол",
    spec: "По всей площади",
    desc: "Водяной тёплый пол по умолчанию во всех модулях.",
  },
  {
    icon: Wind,
    title: "Приточно-вытяжная вентиляция",
    spec: "С рекуперацией",
    desc: "КПД 85% — свежий воздух без потери тепла зимой.",
  },
  {
    icon: Cpu,
    title: "Подготовка под умный дом",
    spec: "KNX / Wi-Fi",
    desc: "Шины и точки подключения для сценариев освещения и климата.",
  },
  {
    icon: Zap,
    title: "Энергоэффективность",
    spec: "Класс A+++",
    desc: "Расход на отопление в 3 раза ниже норматива СНиП.",
  },
  {
    icon: PanelsTopLeft,
    title: "Панорамное остекление",
    spec: "Двухкамерные стеклопакеты",
    desc: "Энергосберегающее i-стекло, заполнение аргоном.",
  },
];

export function EngineeringFeatures() {
  return (
    <div>
      <div className="mb-12 max-w-3xl">
        <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">
          Инженерия
        </p>
        <h2 className="mt-3 text-3xl font-bold uppercase tracking-tight md:text-5xl">
          Передовая инженерия из коробки
        </h2>
        <p className="mt-4 text-muted-foreground">
          Каждый модуль EcoCub приезжает на участок с готовыми инженерными системами.
          Ничего не нужно докупать или заказывать у сторонних подрядчиков.
        </p>
      </div>

      <div className="grid gap-px overflow-hidden rounded-sm bg-border md:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => {
          const Icon = f.icon;
          return (
            <div key={f.title} className="flex flex-col bg-background p-8">
              <Icon className="size-8 text-accent" strokeWidth={1.5} />
              <h3 className="mt-6 text-lg font-semibold tracking-tight">{f.title}</h3>
              <p className="mt-1 text-sm font-medium text-accent">{f.spec}</p>
              <p className="mt-3 text-sm text-muted-foreground">{f.desc}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
