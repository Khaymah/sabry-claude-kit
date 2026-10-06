const POINTS = [
  { title: "One idea per issue", body: "No roundup of links. A single question, followed all the way down." },
  { title: "Sources you can check", body: "Every claim links to where it came from, so you can keep digging." },
  { title: "Readable in one sitting", body: "About ten minutes. Long enough to learn something, short enough to finish." },
];

export default function Issues() {
  return (
    <section id="issues" data-stop className="relative flex min-h-svh items-center px-6 py-24">
      <div className="mx-auto grid w-full max-w-5xl md:grid-cols-2">
        {/* On phones the object sits above this block, so push the copy down. */}
        <div className="mt-[34svh] md:mt-0">
          <h2 className="font-display text-4xl leading-tight text-balance text-white md:text-5xl">
            Turned over until it makes sense
          </h2>
          <dl className="mt-10 space-y-7">
            {POINTS.map((p) => (
              <div key={p.title}>
                <dt className="text-base font-medium text-white">{p.title}</dt>
                <dd className="mt-1 max-w-sm text-sm leading-relaxed text-white/65">{p.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
