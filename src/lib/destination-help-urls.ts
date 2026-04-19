/**
 * In-app paths for post-connect help (Sheets add-on, Looker connector).
 * Use relative paths so dev/staging/prod all resolve correctly.
 */
export const DESTINATION_HELP_PATHS = {
    lookerStudio: "/looker-studio",
    docs: "/docs",
    transformations: "/transformations",
    sources: "/sources",
    support: "/support",
} as const;
