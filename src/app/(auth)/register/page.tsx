"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  // Clean ChatGPT interface styling

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const registerRes = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });

      const registerData = await registerRes.json();

      if (!registerRes.ok) {
        throw new Error(registerData.message || "Registration failed");
      }

      router.push(`/verify?email=${encodeURIComponent(email)}`);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const signInWithGoogle = async () => {
    setIsGoogleLoading(true);
    await signIn("google", { callbackUrl: "/dashboard" });
  };

  return (
    <div className="w-full flex flex-col items-center bg-white dark:bg-slate-950 min-h-screen pt-16 sm:pt-24 px-4">
      <div className="w-full max-w-[400px] pb-10">
        
        <div className="flex flex-col items-center text-center mb-10">
          {/* Minimalist Monstera Logo */}
          <div className="mb-6 text-gray-900 dark:text-white">
            <svg 
              width="32" 
              height="32" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            >
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
              <path d="M12 7v10M8 12h8" />
            </svg>
          </div>
          <h2 className="text-[32px] font-semibold tracking-tight text-gray-900 dark:text-white">
            Create your account
          </h2>
        </div>

        {/* Google sign-in (only social provider) */}
        <div className="mb-6">
          <button
            onClick={signInWithGoogle}
            disabled={isLoading || isGoogleLoading}
            className="flex items-center justify-center w-full px-6 py-[16px] text-[15px] font-medium text-gray-700 bg-white border border-gray-300 rounded-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-200 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isGoogleLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            ) : (
              <>
                <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
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

        {/* OR Divider */}
        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200 dark:border-slate-800" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="px-3 bg-white dark:bg-slate-900 text-gray-400">
              OR
            </span>
          </div>
        </div>

        <form className="space-y-6" onSubmit={handleSubmit}>
          <div className="hidden">BUILD_ID: v1.0.1-manual-login</div>
          {error && (
            <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm text-center">
              {error}
            </div>
          )}
          
          <div>
            <label htmlFor="name" className="block text-[15px] font-medium text-gray-700 dark:text-gray-300 mb-2">
              Full name
            </label>
            <div className="mt-1">
              <input
                id="name"
                name="name"
                type="text"
                placeholder="e.g. John Smith"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="appearance-none block w-full px-5 py-4 border border-[#d2ddec] dark:border-slate-700 rounded-md placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-[#1ba177] focus:border-[#1ba177] sm:text-[16px] bg-[#f0f4f9] dark:bg-slate-800 text-gray-900 dark:text-white transition-colors"
              />
            </div>
          </div>
          
          <div>
            <label htmlFor="email" className="block text-[15px] font-medium text-gray-700 dark:text-gray-300 mb-2">
              Email
            </label>
            <div className="mt-1">
              <input
                id="email"
                name="email"
                type="email"
                placeholder="jsmith@domain.com"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="appearance-none block w-full px-5 py-4 border border-[#d2ddec] dark:border-slate-700 rounded-md placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-[#1ba177] focus:border-[#1ba177] sm:text-[16px] bg-[#f0f4f9] dark:bg-slate-800 text-gray-900 dark:text-white transition-colors"
              />
            </div>
          </div>

          <div>
            <label htmlFor="password" className="block text-[15px] font-medium text-gray-700 dark:text-gray-300 mb-2">
              Password
            </label>
            <div className="mt-1">
              <input
                id="password"
                name="password"
                type="password"
                placeholder="••••••••••••"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="appearance-none block w-full px-5 py-4 border border-[#d2ddec] dark:border-slate-700 rounded-md placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-[#1ba177] focus:border-[#1ba177] sm:text-[16px] bg-[#f0f4f9] dark:bg-slate-800 text-gray-900 dark:text-white transition-colors"
              />
            </div>
            <p className="mt-2 text-[13.5px] text-gray-500 dark:text-gray-400">
              Make sure it's at least 8 characters including a number and a lowercase letter.
            </p>
          </div>

          <div>
            <label htmlFor="confirmPassword" className="block text-[15px] font-medium text-gray-700 dark:text-gray-300 mb-2">
              Reconfirm password
            </label>
            <div className="mt-1">
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                placeholder="••••••••••••"
                autoComplete="new-password"
                required
                className="appearance-none block w-full px-5 py-4 border border-[#d2ddec] dark:border-slate-700 rounded-md placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-[#1ba177] focus:border-[#1ba177] sm:text-[16px] bg-[#f0f4f9] dark:bg-slate-800 text-gray-900 dark:text-white transition-colors"
                onChange={(e) => {
                  if (e.target.value !== password && e.target.value.length > 0) {
                     e.target.setCustomValidity("Passwords do not match");
                  } else {
                     e.target.setCustomValidity("");
                  }
                }}
              />
            </div>
          </div>

          <div className="pt-4">
            <button
              type="submit"
              disabled={isLoading || isGoogleLoading}
              className="w-full flex justify-center py-4 px-4 border border-transparent rounded-md text-[16px] font-medium text-white bg-[#1ba177] hover:bg-[#178c66] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#1ba177] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Continue"}
            </button>
          </div>
        </form>

        <p className="mt-14 text-center text-[15px] text-gray-500 dark:text-gray-400">
          Already have an account?{" "}
          <Link
            href="/login"
            className="text-[#1ba177] hover:underline font-medium"
          >
            Log in
          </Link>
        </p>

      </div>
    </div>
  );
}
