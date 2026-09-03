"use client";

import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Logo } from "@/components/Logo";
import { metaPixelCustom } from "@/lib/meta-pixel";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [inviteToken, setInviteToken] = useState("");
  const [isPilotOffer, setIsPilotOffer] = useState(false);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const token = searchParams.get("invite")?.trim() || "";
    setInviteToken(token);
    setIsPilotOffer(searchParams.get("offer") === "agency-pro-pilot");
    if (token) sessionStorage.setItem("monstera_pending_invitation", token);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const registerRes = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, inviteToken }),
      });

      const registerData = await registerRes.json();

      if (!registerRes.ok) {
        throw new Error(registerData.message || "Registration failed");
      }

      metaPixelCustom("MC_SignUp_Email_AccountCreated", { method: "email" });
      try {
        sessionStorage.setItem("monstera_pending_verify_email", email.trim());
      } catch {
        /* storage blocked — verify page may prompt for email */
      }
      router.push("/verify");
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const signInWithGoogle = async () => {
    metaPixelCustom("MC_SignUp_Google_Click", { method: "google" });
    setIsGoogleLoading(true);
    await signIn("google", {
      callbackUrl: `/auth/continue?next=${encodeURIComponent("/console")}`,
    });
  };

  return (
    <div className="w-full flex flex-col min-h-screen justify-between bg-black text-white selection:bg-neutral-800">
      {/* Top Header */}
      <header className="w-full max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group">
          <Logo className="w-7 h-7" textClassName="text-sm font-semibold tracking-tight text-white" />
        </Link>
        <Link
          href="/login"
          className="text-xs font-medium text-neutral-300 hover:text-white px-3.5 py-1.5 rounded-full border border-[#262626] bg-[#0c0c0c] hover:bg-[#161616] hover:border-[#3a3a3a] transition-all"
        >
          Log In
        </Link>
      </header>

      {/* Main Form Center */}
      <main className="w-full max-w-[380px] mx-auto px-4 py-8 flex flex-col items-center">
        <div className="w-full text-center mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Create your account
          </h1>
          <p className="mt-2 text-xs sm:text-sm text-neutral-400 font-normal leading-relaxed">
            Start normalizing and automating client performance reporting in minutes.
          </p>
          {inviteToken && (
            <div className="mt-4 p-3 border border-[#222] bg-[#0c0c0c] text-white rounded-lg text-xs font-medium w-full text-center">
              Agency pilot invitation token detected.
            </div>
          )}
          {!inviteToken && isPilotOffer && (
            <div className="mt-4 w-full rounded-lg border border-emerald-400/20 bg-emerald-400/[0.06] p-3 text-center text-xs text-emerald-100">
              7-day Agency Pro pilot · no card required · continue for 1,490,000 VND/month
            </div>
          )}
        </div>

        {/* Google OAuth */}
        {!inviteToken && (
          <div className="w-full space-y-3 mb-6">
            <button
              onClick={signInWithGoogle}
              disabled={isLoading || isGoogleLoading}
              className="w-full flex items-center justify-center gap-3 bg-[#0d0d0d] hover:bg-[#161616] border border-[#222] hover:border-[#333] text-white font-medium py-2.5 px-4 rounded-lg text-sm transition-all shadow-sm active:scale-[0.99] disabled:opacity-50"
            >
              {isGoogleLoading ? (
                <Loader2 className="w-4 h-4 animate-spin text-neutral-400" />
              ) : (
                <>
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <path d="M23.766 12.2764C23.766 11.4607 23.6999 10.6406 23.5588 9.83807H12.24V14.4591H18.7217C18.4528 15.9494 17.5885 17.2678 16.323 18.1056V21.1039H20.19C22.4608 19.0139 23.766 15.9274 23.766 12.2764Z" fill="#4285F4" />
                    <path d="M12.2401 24.0008C15.4766 24.0008 18.2059 22.9382 20.1945 21.1039L16.3276 18.1055C15.2517 18.8375 13.8627 19.252 12.2445 19.252C9.11388 19.252 6.45946 17.1399 5.50705 14.3003H1.5166V17.3912C3.55371 21.4434 7.7029 24.0008 12.2401 24.0008Z" fill="#34A853" />
                    <path d="M5.50253 14.3003C5.00015 12.8099 5.00015 11.1961 5.50253 9.70575V6.61481H1.51649C-0.18551 10.0056 -0.18551 14.0004 1.51649 17.3912L5.50253 14.3003Z" fill="#FBBC04" />
                    <path d="M12.2401 4.74966C13.9509 4.7232 15.6044 5.36697 16.8434 6.54867L20.2695 3.12262C18.1001 1.0855 15.2208 -0.034466 12.2401 0.000808666C7.7029 0.000808666 3.55371 2.55822 1.5166 6.61481L5.50264 9.70575C6.45064 6.86173 9.10947 4.74966 12.2401 4.74966Z" fill="#EA4335" />
                  </svg>
                  Continue with Google
                </>
              )}
            </button>
          </div>
        )}

        {/* OR Divider */}
        {!inviteToken && (
          <div className="relative w-full mb-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[#1e1e1e]" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="px-3 bg-black text-neutral-500 font-medium text-[11px] uppercase tracking-wider">
                OR
              </span>
            </div>
          </div>
        )}

        {/* Email & Password Registration Form */}
        <form className="w-full space-y-4" method="post" action="#" onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-950/50 border border-red-900/60 text-red-300 px-3.5 py-2.5 rounded-lg text-xs text-center font-medium">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="name" className="block text-xs font-medium text-neutral-300 mb-1.5">
              Full Name
            </label>
            <input
              id="name"
              name="name"
              type="text"
              placeholder="Alex Smith"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-[#0a0a0a] border border-[#222] focus:border-white focus:outline-none focus:ring-1 focus:ring-white rounded-lg text-sm text-white placeholder:text-neutral-600 px-3.5 py-2.5 transition-colors"
            />
          </div>

          <div>
            <label htmlFor="email" className="block text-xs font-medium text-neutral-300 mb-1.5">
              Work Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              placeholder="alex@agency.com"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-[#0a0a0a] border border-[#222] focus:border-white focus:outline-none focus:ring-1 focus:ring-white rounded-lg text-sm text-white placeholder:text-neutral-600 px-3.5 py-2.5 transition-colors"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-xs font-medium text-neutral-300 mb-1.5">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              placeholder="••••••••••••"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-[#0a0a0a] border border-[#222] focus:border-white focus:outline-none focus:ring-1 focus:ring-white rounded-lg text-sm text-white placeholder:text-neutral-600 px-3.5 py-2.5 transition-colors"
            />
            <p className="mt-1.5 text-[11px] text-neutral-500">
              Minimum 8 characters with at least one letter and one number.
            </p>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={isLoading || isGoogleLoading}
              className="w-full flex items-center justify-center py-2.5 px-4 rounded-lg text-sm font-semibold text-black bg-white hover:bg-neutral-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-black focus:ring-white disabled:opacity-50 transition-all shadow-sm active:scale-[0.99]"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin text-black" /> : "Create Account"}
            </button>
          </div>
        </form>

        <p className="mt-8 text-center text-xs text-neutral-400">
          Already have an account?{" "}
          <Link
            href="/login"
            className="text-white hover:underline font-medium"
          >
            Log in
          </Link>
        </p>
      </main>

      {/* Bottom Footer */}
      <footer className="w-full max-w-6xl mx-auto px-6 py-6 flex flex-wrap items-center justify-center gap-6 text-xs text-neutral-600">
        <Link href="/legal/terms-of-service" className="hover:text-neutral-400 transition-colors">
          Terms of Service
        </Link>
        <span className="text-neutral-700">·</span>
        <Link href="/legal/privacy-policy" className="hover:text-neutral-400 transition-colors">
          Privacy Policy
        </Link>
        <span className="text-neutral-700">·</span>
        <Link href="/support" className="hover:text-neutral-400 transition-colors">
          Support
        </Link>
      </footer>
    </div>
  );
}
