import { useState, type FormEvent } from "react";
import { ArrowRight, Globe, Instagram, Twitter, type LucideIcon } from "lucide-react";
import BackgroundVideo from "./BackgroundVideo";

const BRAND = "Asme";
const HEADLINE = "Built for the curious";
const SUBTITLE =
  "Stay updated with the latest news and insights. Subscribe to our newsletter today and never miss out on exciting updates.";

const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "Pricing", href: "#pricing" },
  { label: "About", href: "#about" },
];

const SOCIAL_LINKS: { label: string; href: string; Icon: LucideIcon }[] = [
  { label: "Instagram", href: "#", Icon: Instagram },
  { label: "Twitter", href: "#", Icon: Twitter },
  { label: "Website", href: "#", Icon: Globe },
];

export default function HeroSection() {
  const [email, setEmail] = useState("");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email) return;
    // Hook up the newsletter provider here.
    setEmail("");
  };

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-black">
      <BackgroundVideo />

      {/* Navigation */}
      <nav className="relative z-20 pl-6 pr-6 py-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between rounded-full px-6 py-3">
          <div className="flex items-center gap-8">
            <a href="/" className="flex items-center gap-2 text-white">
              <Globe size={24} />
              <span className="text-lg font-semibold">{BRAND}</span>
            </a>
            <div className="hidden items-center gap-8 md:flex">
              {NAV_LINKS.map(({ label, href }) => (
                <a
                  key={label}
                  href={href}
                  className="text-sm font-medium text-white/80 transition-colors hover:text-white"
                >
                  {label}
                </a>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button type="button" className="text-sm font-medium text-white">
              Sign Up
            </button>
            <button
              type="button"
              className="liquid-glass rounded-full px-6 py-2 text-sm font-medium text-white"
            >
              Login
            </button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <main className="relative z-10 flex flex-1 -translate-y-[20%] flex-col items-center justify-center px-6 py-12 text-center">
        <h1
          className="mb-8 whitespace-nowrap text-5xl tracking-tight text-white md:text-6xl lg:text-7xl"
          style={{ fontFamily: "'Instrument Serif', serif" }}
        >
          {HEADLINE}
        </h1>

        <div className="w-full max-w-xl space-y-4">
          <form
            onSubmit={handleSubmit}
            className="liquid-glass flex items-center gap-3 rounded-full py-2 pl-6 pr-2"
          >
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Enter your email"
              aria-label="Email address"
              className="min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-white/40"
            />
            <button
              type="submit"
              aria-label="Subscribe"
              className="rounded-full bg-white p-3 text-black"
            >
              <ArrowRight size={20} />
            </button>
          </form>

          <p className="px-4 text-sm leading-relaxed text-white">{SUBTITLE}</p>

          <div className="flex justify-center">
            <button
              type="button"
              className="liquid-glass rounded-full px-8 py-3 text-sm font-medium text-white transition-colors hover:bg-white/5"
            >
              Manifesto
            </button>
          </div>
        </div>
      </main>

      {/* Social */}
      <footer className="relative z-10 flex justify-center gap-4 pb-12">
        {SOCIAL_LINKS.map(({ label, href, Icon }) => (
          <a
            key={label}
            href={href}
            aria-label={label}
            className="liquid-glass rounded-full p-4 text-white/80 transition-all hover:bg-white/5 hover:text-white"
          >
            <Icon size={20} />
          </a>
        ))}
      </footer>
    </div>
  );
}
