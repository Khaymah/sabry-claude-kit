import EmailForm from "./EmailForm";

export default function Hero() {
  return (
    <section id="top" data-stop className="relative flex min-h-svh flex-col items-center px-6 pt-[22svh] text-center">
      <h1 className="font-display text-5xl tracking-tight text-white sm:text-6xl lg:text-7xl">Built for the curious</h1>
      <p className="mt-5 max-w-md text-base leading-relaxed text-white/70">
        One idea a week, taken apart until it makes sense. Free, in your inbox every Sunday.
      </p>
      <div className="mt-8 w-full max-w-md">
        <EmailForm id="hero-email" />
      </div>
    </section>
  );
}
