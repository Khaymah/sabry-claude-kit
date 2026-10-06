import { Globe, Instagram, Twitter, type LucideIcon } from "lucide-react";
import EmailForm from "./EmailForm";

const SOCIAL: { label: string; href: string; Icon: LucideIcon }[] = [
  { label: "Instagram", href: "#", Icon: Instagram },
  { label: "Twitter", href: "#", Icon: Twitter },
  { label: "Website", href: "#", Icon: Globe },
];

export default function Join() {
  return (
    <section id="join" data-stop className="relative flex min-h-svh flex-col items-center justify-end px-6 pb-12 text-center">
      <div id="about" className="w-full max-w-md">
        <h2 className="font-display text-4xl text-balance text-white md:text-5xl">Start with next Sunday</h2>
        <p className="mt-4 text-sm leading-relaxed text-white/65">
          Written by people who read too much, for people who ask why too often. Unsubscribe in one click.
        </p>
        <div className="mt-8">
          <EmailForm id="join-email" />
        </div>
      </div>
      <footer className="mt-16 flex gap-4">
        {SOCIAL.map(({ label, href, Icon }) => (
          <a
            key={label}
            href={href}
            aria-label={label}
            className="liquid-glass rounded-full p-4 text-white/80 transition-colors hover:bg-white/5 hover:text-white"
          >
            <Icon size={20} />
          </a>
        ))}
      </footer>
    </section>
  );
}
