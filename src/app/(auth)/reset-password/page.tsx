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
        <div className="w-full flex flex-col items-center bg-white dark:bg-slate-950 min-h-screen pt-16 sm:pt-24 px-4">
            <div className="w-full max-w-[400px] pb-10">
                <div className="flex flex-col items-center text-center mb-10">
                    <div className="mb-6 text-gray-900 dark:text-white">
                        <Logo className="w-8 h-8" textClassName="hidden" />
                    </div>
                    <h2 className="text-[32px] font-semibold tracking-tight text-gray-900 dark:text-white">
                        Set new password
                    </h2>
                    <p className="mt-3 text-[15px] text-gray-500 dark:text-gray-400">
                        Choose a strong password for your account.
                    </p>
                </div>

                {done ? (
                    <div className="flex flex-col items-center text-center space-y-4">
                        <CheckCircle className="w-12 h-12 text-[#1ba177]" />
                        <h3 className="text-xl font-semibold text-gray-900 dark:text-white">Password updated!</h3>
                        <p className="text-[15px] text-gray-500 dark:text-gray-400">
                            Redirecting you to sign in...
                        </p>
                    </div>
                ) : (
                    <form className="space-y-6" onSubmit={handleSubmit}>
                        {error && (
                            <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm text-center">
                                {error}
                            </div>
                        )}

                        <div>
                            <label htmlFor="password" className="block text-[15px] font-medium text-gray-700 dark:text-gray-300 mb-2">
                                New password
                            </label>
                            <div className="relative">
                                <input
                                    id="password"
                                    type={showPassword ? "text" : "password"}
                                    placeholder="Min. 8 characters"
                                    required
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="appearance-none block w-full px-5 py-4 pr-12 border border-[#d2ddec] dark:border-slate-700 rounded-md placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-[#1ba177] focus:border-[#1ba177] sm:text-[16px] bg-[#f0f4f9] dark:bg-slate-800 text-gray-900 dark:text-white transition-colors"
                                />
                                <button
                                    type="button"
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                    onClick={() => setShowPassword(!showPassword)}
                                >
                                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                </button>
                            </div>
                        </div>

                        <div>
                            <label htmlFor="confirmPassword" className="block text-[15px] font-medium text-gray-700 dark:text-gray-300 mb-2">
                                Confirm new password
                            </label>
                            <input
                                id="confirmPassword"
                                type={showPassword ? "text" : "password"}
                                placeholder="••••••••••••"
                                required
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className="appearance-none block w-full px-5 py-4 border border-[#d2ddec] dark:border-slate-700 rounded-md placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-[#1ba177] focus:border-[#1ba177] sm:text-[16px] bg-[#f0f4f9] dark:bg-slate-800 text-gray-900 dark:text-white transition-colors"
                            />
                        </div>

                        <div className="pt-2">
                            <button
                                type="submit"
                                disabled={isLoading}
                                className="w-full flex justify-center py-4 px-4 border border-transparent rounded-md text-[16px] font-medium text-white bg-[#1ba177] hover:bg-[#178c66] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#1ba177] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Update password"}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}

export default function ResetPasswordPage() {
    return (
        <Suspense fallback={
            <div className="flex items-center justify-center min-h-screen">
                <Loader2 className="w-8 h-8 animate-spin text-[#1ba177]" />
            </div>
        }>
            <ResetPasswordContent />
        </Suspense>
    );
}
