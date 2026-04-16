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
                /** Brand — semantic aliases over cyan scale */
                primary: {
                    DEFAULT: "#0891b2",
                    foreground: "#ffffff",
                    muted: "#ecfeff",
                    ring: "#06b6d4",
                    hover: "#0e7490",
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
