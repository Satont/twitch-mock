import { rm } from 'node:fs/promises';
import tailwind from 'bun-plugin-tailwind';

await rm(new URL('./dist', import.meta.url), { recursive: true, force: true });

const target = process.env.BUN_COMPILE_TARGET as Bun.Build.CompileTarget | undefined;

const result = await Bun.build({
  entrypoints: ['./src/server/index.ts'],
  compile: { outfile: './dist/twitch-mock', ...(target ? { target } : {}) },
  plugins: [tailwind],
  minify: true,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
});

for (const log of result.logs) console.error(log);

if (!result.success) process.exit(1);
