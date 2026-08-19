
"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, ArrowLeft } from "lucide-react";
import { Logo } from "@/components/Logo";
import { metaPixelCustom, metaPixelStandard } from "@/lib/meta-pixel";

function VerifyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [timer, setTimer] = useState(60);

  useEffect(() => {
    if (timer > 0) {
      const interval = setInterval(() => setTimer((prev) => prev - 1), 1000);
      return () => clearInterval(interval);
    }
  }, [timer]);

  /** Prefer sessionStorage (set at registration) so email is not leaked via URL (CWE-598). */
  useEffect(() => {
    const q = searchParams.get("email")?.trim() || "";
    if (typeof window === "undefined") return;
    if (q) {
      try {
        sessionStorage.setItem("monstera_pending_verify_email", q);
      } catch {
        /* ignore */
      }
      setEmail(q);
      router.replace("/verify");
      return;
    }
    try {
      setEmail(sessionStorage.getItem("monstera_pending_verify_email")?.trim() || "");
    } catch {
      setEmail("");
    }
  }, [searchParams, router]);

  const handleChange = (index: number, value: string) => {
    if (value.length > 1) value = value[value.length - 1];
    if (!/^\d*$/.test(value)) return;

    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);

    // Auto-focus next input
    if (value && index < 5) {
      const nextInput = document.getElementById(`otp-${index + 1}`);
      nextInput?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      const prevInput = document.getElementById(`otp-${index - 1}`);
      prevInput?.focus();
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const otpString = otp.join("");
    if (otpString.length < 6) {
      setError("Please enter all 6 digits.");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp: otpString }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Verification failed");
      }

      metaPixelStandard("CompleteRegistration", { content_name: "email_verified" });
      metaPixelCustom("MC_SignUp_Email_Verified", { method: "email" });
      try {
        sessionStorage.removeItem("monstera_pending_verify_email");
      } catch {
        /* ignore */
      }
      let inviteToken = "";
      try {
        inviteToken = sessionStorage.getItem("monstera_pending_invitation") || "";
      } catch {
        /* ignore */
      }
      const callbackUrl = inviteToken ? `/invite/${inviteToken}` : "/console";
      router.push(`/login?registered=true&callbackUrl=${encodeURIComponent(callbackUrl)}`);
    } catch (err: any) {
      setError(err.message || "An error occurred.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    if (timer > 0) return;

    setIsResending(true);
    setError("");
    setMessage("");

    try {
      const res = await fetch("/api/auth/resend-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) throw new Error("Failed to resend OTP");

      setMessage("Verification code sent successfully!");
      setTimer(60);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsResending(false);
    }
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

      {/* Main Center Form */}
      <main className="w-full max-w-[380px] mx-auto px-4 py-8 flex flex-col items-center">
        <div className="w-full text-center mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Verify your email
          </h1>
          <p className="mt-2 text-xs sm:text-sm text-neutral-400 font-normal leading-relaxed">
            {email ? (
              <>
                We&apos;ve sent a 6-digit code to{" "}
                <span className="font-semibold text-white">{email}</span>. Enter it below to complete
                your verification.
              </>
            ) : (
              <>
                If you just registered, open this page from the same browser, or{" "}
                <Link href="/register" className="text-white font-semibold hover:underline">
                  start again
                </Link>
                .
              </>
            )}
          </p>
        </div>

        <form onSubmit={handleSubmit} method="post" action="#" className="w-full space-y-6">
          {error && (
            <div className="bg-red-950/50 border border-red-900/60 text-red-300 px-3.5 py-2.5 rounded-lg text-xs text-center font-medium">
              {error}
            </div>
          )}
          {message && (
            <div className="border border-[#222] bg-[#0c0c0c] text-white p-3 rounded-lg text-xs text-center">
              {message}
            </div>
          )}

          <div className="flex justify-between gap-2">
            {otp.map((digit, index) => (
              <input
                key={index}
                id={`otp-${index}`}
                type="text"
                maxLength={1}
                value={digit}
                onChange={(e) => handleChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                className="w-12 h-12 text-center text-xl font-bold border border-[#222] rounded-lg focus:outline-none focus:ring-1 focus:ring-white focus:border-white bg-[#0a0a0a] text-white transition-all"
              />
            ))}
          </div>

          <button
            type="submit"
            disabled={isLoading || otp.some((d) => !d)}
            className="w-full flex items-center justify-center py-2.5 px-4 rounded-lg text-sm font-semibold text-black bg-white hover:bg-neutral-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-black focus:ring-white disabled:opacity-50 transition-all shadow-sm active:scale-[0.99]"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin text-black" /> : "Verify Identity"}
          </button>
        </form>

        <div className="mt-8 text-center space-y-3">
          <p className="text-xs text-neutral-400">
            Didn't receive the code?{" "}
            <button
              onClick={handleResend}
              disabled={timer > 0 || isResending}
              className={`font-medium transition-colors ${
                timer > 0 || isResending 
                  ? "text-neutral-600 cursor-not-allowed" 
                  : "text-white hover:underline"
              }`}
            >
              {isResending ? "Resending..." : timer > 0 ? `Resend in ${timer}s` : "Resend OTP"}
            </button>
          </p>
          
          <div>
            <Link
              href="/register"
              className="inline-flex items-center text-neutral-500 hover:text-neutral-300 text-xs transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
              Back to registration
            </Link>
          </div>
        </div>
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

export default function VerifyPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-white" />
      </div>
    }>
      <VerifyContent />
    </Suspense>
  );
}
