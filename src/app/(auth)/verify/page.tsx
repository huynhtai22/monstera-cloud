
"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, ArrowLeft } from "lucide-react";
import { Logo } from "@/components/Logo";

function VerifyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") || "";
  
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

      router.push("/login?registered=true");
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
    <div className="w-full flex flex-col items-center bg-white dark:bg-slate-950 min-h-screen pt-16 sm:pt-24 px-4">
      <div className="w-full max-w-[440px] pb-10">
        
        <div className="flex flex-col items-center text-center mb-10">
          <div className="mb-6 text-gray-900 dark:text-white">
            <Logo className="w-8 h-8" textClassName="hidden" />
          </div>
          <h2 className="text-[32px] font-semibold tracking-tight text-gray-900 dark:text-white">
            Verify your email
          </h2>
          <p className="mt-4 text-gray-500 text-[15px]">
            We've sent a 6-digit code to <span className="font-semibold text-gray-900 dark:text-white">{email}</span>. 
            Enter it below to complete your registration.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          {error && (
            <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm text-center">
              {error}
            </div>
          )}
          {message && (
            <div className="bg-emerald-50 text-emerald-700 p-3 rounded-md text-sm text-center">
              {message}
            </div>
          )}

          <div className="flex justify-between gap-2 sm:gap-4">
            {otp.map((digit, index) => (
              <input
                key={index}
                id={`otp-${index}`}
                type="text"
                maxLength={1}
                value={digit}
                onChange={(e) => handleChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                className="w-full aspect-square text-center text-2xl font-bold border border-[#d2ddec] dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1ba177] focus:border-transparent bg-[#f0f4f9] dark:bg-slate-800 text-gray-900 dark:text-white transition-all shadow-sm"
              />
            ))}
          </div>

          <button
            type="submit"
            disabled={isLoading || otp.some((d) => !d)}
            className="w-full flex justify-center py-4 px-4 border border-transparent rounded-md text-[16px] font-medium text-white bg-[#1ba177] hover:bg-[#178c66] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#1ba177] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Verify Identity"}
          </button>
        </form>

        <div className="mt-8 text-center">
          <p className="text-[15px] text-gray-500">
            Didn't receive the code?{" "}
            <button
              onClick={handleResend}
              disabled={timer > 0 || isResending}
              className={`font-semibold transition-colors ${
                timer > 0 || isResending 
                  ? "text-gray-300 cursor-not-allowed" 
                  : "text-[#1ba177] hover:underline"
              }`}
            >
              {isResending ? "Resending..." : timer > 0 ? `Resend in ${timer}s` : "Resend OTP"}
            </button>
          </p>
          
          <Link
            href="/register"
            className="mt-6 inline-flex items-center text-gray-500 hover:text-gray-900 dark:hover:text-white text-sm transition-colors"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to registration
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-[#1ba177]" />
      </div>
    }>
      <VerifyContent />
    </Suspense>
  );
}
