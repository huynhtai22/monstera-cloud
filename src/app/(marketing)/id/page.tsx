import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { PRODUCT_SITE_URL } from "@/lib/site-url";

export const metadata: Metadata = {
    title: "Bahasa Indonesia — Monstera Cloud",
    description:
        "Hubungkan TikTok Ads, Meta, Shopee, dan Google Ads ke Google Sheets atau Looker Studio. Untuk seller dan agensi di Asia Tenggara.",
    alternates: { canonical: `${PRODUCT_SITE_URL}/id` },
};

export default function MarketingIdPage() {
    return (
        <div className="mx-auto max-w-3xl px-6 py-24">
            <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-gray-500">Bahasa Indonesia</p>
            <h1 className="text-4xl font-black tracking-tight text-white md:text-5xl">
                Data iklan Anda,{" "}
                <span className="bg-gradient-to-r from-cyan-400 to-emerald-400 bg-clip-text text-transparent">otomatis</span> di spreadsheet.
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-gray-400">
                Monstera Cloud menghubungkan TikTok Ads, Meta Ads, Shopee, dan Google Ads ke Google Sheets™ atau Looker Studio™ — tanpa kode. Dibangun
                untuk brand e-commerce dan agensi di Indonesia, Vietnam, Thailand, Malaysia, dan Singapura.
            </p>
            <ul className="mt-10 space-y-3 text-sm text-gray-300">
                <li className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-500" aria-hidden />
                    OAuth resmi ke setiap platform — Anda mengontrol akses.
                </li>
                <li className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-500" aria-hidden />
                    Enkripsi untuk kunci API dan token; tagihan USD atau VND di halaman harga.
                </li>
                <li className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-500" aria-hidden />
                    Halaman utama dan dokumentasi tersedia dalam bahasa Inggris dan Vietnam; tim mendukung pertanyaan onboarding via email.
                </li>
            </ul>
            <div className="mt-12 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Link
                    href="/register"
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-600 px-6 py-3 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-cyan-700"
                >
                    Mulai gratis
                    <ArrowRight className="h-4 w-4" />
                </Link>
                <Link href="/" className="text-sm font-medium text-gray-400 underline-offset-2 hover:text-white hover:underline">
                    English home
                </Link>
                <Link href="/pricing" className="text-sm font-medium text-gray-400 underline-offset-2 hover:text-white hover:underline">
                    Harga (USD / VND)
                </Link>
                <Link href="/support" className="text-sm font-medium text-gray-400 underline-offset-2 hover:text-white hover:underline">
                    Bantuan
                </Link>
            </div>
        </div>
    );
}
