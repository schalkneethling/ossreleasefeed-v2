// @fontsource-variable packages resolve their package.json "exports" "."
// entry to a CSS file, but the bare specifier itself has no type
// declarations, which TypeScript 6 now flags (TS2882) for side-effect
// imports even though vite/client's `declare module "*.css"` covers the
// explicit-extension @fontsource/* imports right next to this one.
declare module "@fontsource-variable/bricolage-grotesque";
