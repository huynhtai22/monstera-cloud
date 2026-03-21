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
        <div className="w-full flex flex-col items-center bg-white dark:bg-slate-950 min-h-screen pt-16 sm:pt-24 px-4">
            <div className="w-full max-w-[400px] pb-10">
                <div className="flex flex-col items-center text-center mb-10">
                    <div className="mb-6 text-gray-900 dark:text-white">
                        <Logo className="w-8 h-8" textClassName="hidden" />
                    </div>
                    <h2 className="text-[32px] font-semibold tracking-tight text-gray-900 dark:text-white">
                        Reset your password
                    </h2>
                    <p className="mt-3 text-[15px] text-gray-500 dark:text-gray-400">
                        Enter your email and we&apos;ll send you a reset link.
                    </p>
                </div>

                {sent ? (
                    <div className="flex flex-col items-center text-center space-y-4">
                        <CheckCircle className="w-12 h-12 text-[#1ba177]" />
                        <h3 className="text-xl font-semibold text-gray-900 dark:text-white">Check your inbox</h3>
                        <p className="text-[15px] text-gray-500 dark:text-gray-400">
                            If an account exists for <strong>{email}</strong>, we've sent a password reset link. It expires in 1 hour.
                        </p>
                        <Link
                            href="/login"
                            className="mt-4 flex items-center justify-center text-[15px] text-[#1ba177] hover:underline font-medium"
                        >
                            <ArrowLeft className="w-4 h-4 mr-1" />
                            Back to sign in
                        </Link>
                    </div>
                ) : (
                    <form className="space-y-6" onSubmit={handleSubmit}>
                        {error && (
                            <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm text-center">
                                {error}
                            </div>
                        )}

                        <div>
                            <label htmlFor="email" className="block text-[15px] font-medium text-gray-700 dark:text-gray-300 mb-2">
                                Email
                            </label>
                            <input
                                id="email"
                                type="email"
                                placeholder="jsmith@domain.com"
                                autoComplete="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="appearance-none block w-full px-5 py-4 border border-[#d2ddec] dark:border-slate-700 rounded-md placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-[#1ba177] focus:border-[#1ba177] sm:text-[16px] bg-[#f0f4f9] dark:bg-slate-800 text-gray-900 dark:text-white transition-colors"
                            />
                        </div>

                        <div className="pt-2">
                            <button
                                type="submit"
                                disabled={isLoading}
                                className="w-full flex justify-center py-4 px-4 border border-transparent rounded-md text-[16px] font-medium text-white bg-[#1ba177] hover:bg-[#178c66] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#1ba177] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Send reset link"}
                            </button>
                        </div>

                        <p className="text-center text-[15px] text-gray-500 dark:text-gray-400">
                            <Link href="/login" className="flex items-center justify-center text-[#1ba177] hover:underline font-medium">
                                <ArrowLeft className="w-4 h-4 mr-1" />
                                Back to sign in
                            </Link>
                        </p>
                    </form>
                )}
            </div>
        </div>
    );
}
