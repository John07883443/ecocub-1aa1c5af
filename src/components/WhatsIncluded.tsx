import {
  Building2,
  Layers,
  Home,
  Plug,
  Thermometer,
  DoorOpen,
  PaintBucket,
  Truck,
  ShieldCheck,
} from "lucide-react";

const items = [
  { icon: Building2, title: "Фундамент", desc: "Монолитная плита или ленточный — рассчитываем под ваш участок" },
  { icon: Layers, title: "Монолитные модули", desc: "Бетон М400 + оцинкованная сталь + утеплитель ПСБ-С35" },
  { icon: Home, title: "Чистовая отделка фасада", desc: "Декоративная штукатурка или вентфасад на выбор" },
  { icon: Building2, title: "Эксплуатируемая кровля", desc: "С разуклонкой и водостоками по технологии Технониколь" },
  { icon: Plug, title: "Черновая электрика", desc: "Электрощиток, разводка по дому, водяные розетки" },
  { icon: Thermometer, title: "Тёплые полы", desc: "По всему периметру дома + утеплитель по контуру" },
  { icon: DoorOpen, title: "Окна и двери", desc: "Панорамные окна с двойными стеклопакетами, RAL на выбор" },
  { icon: PaintBucket, title: "Стены под отделку", desc: "Подготовка под декоративную штукатурку или окраску" },
  { icon: Truck, title: "Доставка и монтаж", desc: "Транспортировка модулей и сборка опытной бригадой за 5 дней" },
  { icon: ShieldCheck, title: "Гарантия 50 лет", desc: "На конструкцию модулей и техническую документацию" },
];

export function WhatsIncluded() {
  return (
    <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {items.map((it) => (
        <div key={it.title} className="flex flex-col">
          <div className="flex size-12 items-center justify-center rounded-sm bg-accent/10">
            <it.icon className="size-6 text-accent" />
          </div>
          <h3 className="mt-4 text-base font-semibold uppercase">{it.title}</h3>
          <p className="mt-2 text-sm text-muted-foreground">{it.desc}</p>
        </div>
      ))}
    </div>
  );
}
