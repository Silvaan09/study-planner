/** Markdown files imported as text (esbuild `loader: { '.md': 'text' }` in scripts/build-main.mjs). */
declare module '*.md' {
  const text: string;
  export default text;
}
