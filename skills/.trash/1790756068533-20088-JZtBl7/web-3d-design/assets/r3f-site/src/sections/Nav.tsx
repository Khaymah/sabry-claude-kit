import { Globe } from "lucide-react";

const LINKS = [
  { label: "Issues", href: "#issues" },
  { label: "About", href: "#about" },
  { label: "Join", href: "#join" },
];

export default function Nav() {
  return (
    <nav className="fixed inset-x-0 top-0 z-20 px-4 py-4 md:px-6 md:py-6">
      <div className="liquid-glass mx-auto flex max-w-5xl items-center justify-between rounded-full px-5 py-2.5 md:px-6">
        <div className="flex items-center gap-8">
          <a href="#top" className="flex items-center gap-2 text-white">
            <Globe size={22} />
            <span className="text-lg font-semibold">Asme</span>
          </a>
          <div className="hidden items-center gap-7 md:flex">
            {LINKS.map((l) => (
              <a key={l.label} href={l.href} className="text-sm font-medium text-white/75 transition-colors hover:text-white">
                {l.label}
              </a>
            ))}
          </div>
        </div>
        <a href="#join" className="rounded-full bg-white px-5 py-2 text-sm font-medium text-black">
          Subscribe
        </a>
      </div>
    </nav>
  );
}
