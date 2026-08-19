"use client";

import { useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Loader2, ArrowLeft, CheckCircle } from "lucide-react";

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");
    const [sent, setSent] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError("");

        try {
            const res = await fetch("/api/auth/forgot-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email }),
            });

            const data = await res.json();
            
            if (!res.ok) {
                setError(data.error || "Something went wrong.");
            } else {
                setSent(true);
            }
        } catch {
            setError("An unexpected error occurred. Please try again.");
        } finally {
            setIsLoading(false);
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
                        Reset your password
                    </h1>
                    <p className="mt-2 text-xs sm:text-sm text-neutral-400 font-normal leading-relaxed">
                        Enter your email address and we&apos;ll send you a password recovery link.
                    </p>
                </div>

                {sent ? (
                    <div className="w-full flex flex-col items-center text-center space-y-4 border border-[#222] bg-[#0c0c0c] p-6 rounded-lg">
                        <CheckCircle className="w-10 h-10 text-white" />
                        <h3 className="text-base font-semibold text-white">Check your inbox</h3>
                        <p className="text-xs text-neutral-400">
                            If an account exists for <span className="text-white font-medium">{email}</span>, we've sent a password reset link. It expires in 1 hour.
                        </p>
                        <Link
                            href="/login"
                            className="mt-4 inline-flex items-center justify-center text-xs text-white hover:underline font-medium"
                        >
                            <ArrowLeft className="w-3.5 h-3.5 mr-1" />
                            Back to sign in
                        </Link>
                    </div>
                ) : (
                    <form className="w-full space-y-4" method="post" action="#" onSubmit={handleSubmit}>
                        {error && (
                            <div className="bg-red-950/50 border border-red-900/60 text-red-300 px-3.5 py-2.5 rounded-lg text-xs text-center font-medium">
                                {error}
                            </div>
                        )}

                        <div>
                            <label htmlFor="email" className="block text-xs font-medium text-neutral-300 mb-1.5">
                                Email Address
                            </label>
                            <input
                                id="email"
                                type="email"
                                placeholder="you@agency.com"
                                autoComplete="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full bg-[#0a0a0a] border border-[#222] focus:border-white focus:outline-none focus:ring-1 focus:ring-white rounded-lg text-sm text-white placeholder:text-neutral-600 px-3.5 py-2.5 transition-colors"
                            />
                        </div>

                        <div className="pt-2">
                            <button
                                type="submit"
                                disabled={isLoading}
                                className="w-full flex items-center justify-center py-2.5 px-4 rounded-lg text-sm font-semibold text-black bg-white hover:bg-neutral-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-black focus:ring-white disabled:opacity-50 transition-all shadow-sm active:scale-[0.99]"
                            >
                                {isLoading ? <Loader2 className="w-4 h-4 animate-spin text-black" /> : "Send reset link"}
                            </button>
                        </div>

                        <p className="pt-4 text-center text-xs text-neutral-400">
                            <Link href="/login" className="inline-flex items-center text-neutral-400 hover:text-white transition-colors">
                                <ArrowLeft className="w-3.5 h-3.5 mr-1" />
                                Back to sign in
                            </Link>
                        </p>
                    </form>
                )}
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
