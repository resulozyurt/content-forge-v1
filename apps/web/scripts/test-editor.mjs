import { copyFile, mkdir, rm, access, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";

const require = createRequire(import.meta.url);
const page = resolve("src/app/[locale]/editor-e2e.test/page.tsx");
const fixture = resolve("e2e/editor.fixture.tsx");
try { await access(page); throw new Error("The temporary editor test page already exists. Remove it after checking its contents."); }
catch (error) { if (error.code !== "ENOENT") throw error; }
await mkdir(dirname(page), { recursive: true });
await copyFile(fixture, page);
try {
    const child = spawn(process.execPath, [require.resolve("@playwright/test/cli"), "test", "--config=playwright.editor.config.ts", ...process.argv.slice(2)], { stdio: "inherit", env: process.env });
    process.exitCode = await new Promise((resolveExit, reject) => {
        child.on("error", reject);
        child.on("exit", code => resolveExit(code ?? 1));
    });
} finally {
    // Only the exact file created above is removed; no checkout directories are deleted.
    await rm(page);
    const validator = resolve(".next/dev/types/validator.ts");
    try {
        if ((await readFile(validator, "utf8")).includes("editor-e2e.test")) await rm(validator);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
}
