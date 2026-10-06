import { useState, type FormEvent } from "react";
import { ArrowRight, Check } from "lucide-react";

export default function EmailForm({ id }: { id: string }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!email) return;
    // Call the newsletter / waitlist API here.
    setSent(true);
  };

  return (
    <form onSubmit={onSubmit} className="liquid-glass flex items-center gap-3 rounded-full py-2 pl-6 pr-2">
      <label htmlFor={id} className="sr-only">
        Email address
      </label>
      <input
        id={id}
        type="email"
        required
        value={email}
        disabled={sent}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={sent ? "You're on the list" : "Enter your email"}
        className="min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-white/40"
      />
      <button
        type="submit"
        aria-label={sent ? "Subscribed" : "Subscribe"}
        className="rounded-full bg-white p-3 text-black transition-transform active:scale-95"
      >
        {sent ? <Check size={20} /> : <ArrowRight size={20} />}
      </button>
    </form>
  );
}
