import type { Config } from "tailwindcss";

export default {
    content: [
        "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    darkMode: "class",
    theme: {
        extend: {
            colors: {
                background: "var(--background)",
                foreground: "var(--foreground)",
                primary: {
                    DEFAULT: "#ffffff",
                    foreground: "#000000",
                    muted: "#141414",
                    ring: "#ffffff",
                    hover: "#e5e5e5",
                },
                surface: {
                    muted: "#f9fafb",
                },
            },
            borderRadius: {
                card: "0.75rem",
                control: "0.5rem",
            },
        },
    },
    plugins: [],
} satisfies Config;
