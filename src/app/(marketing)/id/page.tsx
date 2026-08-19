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
        <div className="mx-auto max-w-3xl px-6 pt-32 pb-24 font-sans text-ink">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-line bg-panel text-ink-mute text-xs font-semibold uppercase tracking-wider mb-4">
                <span className="w-1.5 h-1.5 rounded-full bg-accent"></span>
                <span>Bahasa Indonesia</span>
            </div>
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-ink leading-tight">
                Data iklan Anda, <span className="text-accent">otomatis</span> di spreadsheet.
            </h1>
            <p className="mt-6 text-sm sm:text-base leading-relaxed text-ink-mute font-normal">
                Monstera Cloud menghubungkan TikTok Ads, Meta Ads, Shopee, dan Google Ads ke Google Sheets™ atau Looker Studio™ — tanpa kode. Dibangun
                untuk brand e-commerce dan agensi di Indonesia, Vietnam, Thailand, Malaysia, dan Singapura.
            </p>
            <ul className="mt-8 space-y-3 text-xs sm:text-sm text-ink-mute">
                <li className="flex gap-2.5">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
                    <span>OAuth resmi ke setiap platform — Anda mengontrol akses.</span>
                </li>
                <li className="flex gap-2.5">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
                    <span>Enkripsi untuk kunci API dan token; tagihan USD atau VND di halaman harga.</span>
                </li>
                <li className="flex gap-2.5">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
                    <span>Halaman utama dan dokumentasi tersedia dalam bahasa Inggris dan Vietnam; tim mendukung pertanyaan onboarding via email.</span>
                </li>
            </ul>
            <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Link
                    href="/register"
                    className="inline-flex items-center justify-center gap-2 rounded-md bg-white hover:bg-neutral-200 px-6 py-2.5 text-xs font-semibold text-black shadow-xs transition-colors"
                >
                    Mulai gratis
                    <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <Link href="/" className="text-xs font-medium text-ink-mute hover:text-ink transition-colors px-2">
                    English home
                </Link>
                <Link href="/pricing" className="text-xs font-medium text-ink-mute hover:text-ink transition-colors px-2">
                    Harga (USD / VND)
                </Link>
                <Link href="/support" className="text-xs font-medium text-ink-mute hover:text-ink transition-colors px-2">
                    Bantuan
                </Link>
            </div>
        </div>
    );
}
