/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    // Tailwind v4 can emit nested selectors (e.g. from arbitrary variants). LightningCSS requires nesting to be expanded first.
    "postcss-nesting": {},
    "@tailwindcss/postcss": {},
  },
};

export default config;
