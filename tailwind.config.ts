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
                /** Brand — semantic aliases over emerald scale */
                primary: {
                    DEFAULT: "#059669",
                    foreground: "#ffffff",
                    muted: "#ecfdf5",
                    ring: "#10b981",
                    hover: "#047857",
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
