"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Loader2, CheckCircle, Eye, EyeOff } from "lucide-react";

function ResetPasswordContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const token = searchParams.get("token");

    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");
    const [done, setDone] = useState(false);

    if (!token) {
        return (
            <div className="w-full flex flex-col items-center bg-white dark:bg-slate-950 min-h-screen pt-24 px-4">
                <div className="w-full max-w-[400px] text-center">
                    <p className="text-red-500 font-medium">Invalid or missing reset token.</p>
                    <Link href="/forgot-password" className="mt-4 block text-[#1ba177] hover:underline text-sm">
                        Request a new reset link
                    </Link>
                </div>
            </div>
        );
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");

        if (password !== confirmPassword) {
            setError("Passwords do not match.");
            return;
        }

        if (password.length < 8) {
            setError("Password must be at least 8 characters.");
            return;
        }

        setIsLoading(true);

        try {
            const res = await fetch("/api/auth/reset-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token, password }),
            });

            const data = await res.json();

            if (!res.ok) {
                setError(data.error || "Something went wrong.");
            } else {
                setDone(true);
                setTimeout(() => router.push("/login"), 2500);
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
                        Set new password
                    </h1>
                    <p className="mt-2 text-xs sm:text-sm text-neutral-400 font-normal leading-relaxed">
                        Choose a strong password for your account.
                    </p>
                </div>

                {done ? (
                    <div className="w-full flex flex-col items-center text-center space-y-4 border border-[#222] bg-[#0c0c0c] p-6 rounded-lg">
                        <CheckCircle className="w-10 h-10 text-white" />
                        <h3 className="text-base font-semibold text-white">Password updated!</h3>
                        <p className="text-xs text-neutral-400">
                            Redirecting you to sign in...
                        </p>
                    </div>
                ) : (
                    <form className="w-full space-y-4" method="post" action="#" onSubmit={handleSubmit}>
                        {error && (
                            <div className="bg-red-950/50 border border-red-900/60 text-red-300 px-3.5 py-2.5 rounded-lg text-xs text-center font-medium">
                                {error}
                            </div>
                        )}

                        <div>
                            <label htmlFor="password" className="block text-xs font-medium text-neutral-300 mb-1.5">
                                New password
                            </label>
                            <div className="relative">
                                <input
                                    id="password"
                                    name="password"
                                    type={showPassword ? "text" : "password"}
                                    placeholder="Min. 8 characters"
                                    required
                                    autoComplete="new-password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full bg-[#0a0a0a] border border-[#222] focus:border-white focus:outline-none focus:ring-1 focus:ring-white rounded-lg text-sm text-white placeholder:text-neutral-600 px-3.5 py-2.5 pr-10 transition-colors"
                                />
                                <button
                                    type="button"
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white"
                                    onClick={() => setShowPassword(!showPassword)}
                                >
                                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>

                        <div>
                            <label htmlFor="confirmPassword" className="block text-xs font-medium text-neutral-300 mb-1.5">
                                Confirm new password
                            </label>
                            <input
                                id="confirmPassword"
                                name="confirmPassword"
                                type={showPassword ? "text" : "password"}
                                placeholder="••••••••••••"
                                required
                                autoComplete="new-password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className="w-full bg-[#0a0a0a] border border-[#222] focus:border-white focus:outline-none focus:ring-1 focus:ring-white rounded-lg text-sm text-white placeholder:text-neutral-600 px-3.5 py-2.5 transition-colors"
                            />
                        </div>

                        <div className="pt-2">
                            <button
                                type="submit"
                                disabled={isLoading}
                                className="w-full flex items-center justify-center py-2.5 px-4 rounded-lg text-sm font-semibold text-black bg-white hover:bg-neutral-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-black focus:ring-white disabled:opacity-50 transition-all shadow-sm active:scale-[0.99]"
                            >
                                {isLoading ? <Loader2 className="w-4 h-4 animate-spin text-black" /> : "Update password"}
                            </button>
                        </div>
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

export default function ResetPasswordPage() {
    return (
        <Suspense fallback={
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 className="w-6 h-6 animate-spin text-white" />
            </div>
        }>
            <ResetPasswordContent />
        </Suspense>
    );
}
