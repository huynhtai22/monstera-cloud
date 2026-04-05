import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Pixel test",
    robots: { index: false, follow: false },
};

export default function PixelTestLayout({ children }: { children: React.ReactNode }) {
    return children;
}
