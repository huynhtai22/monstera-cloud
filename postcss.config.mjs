/** @type {import('postcss-load-config').Config} */
const config = {
<<<<<<< HEAD
    plugins: {
        "postcss-nesting": {},
        "@tailwindcss/postcss": {},
    },
=======
  plugins: {
    // Tailwind v4 can emit nested selectors (e.g. from arbitrary variants). LightningCSS requires nesting to be expanded first.
    "postcss-nesting": {},
    "@tailwindcss/postcss": {},
  },
>>>>>>> origin/main
};

export default config;
