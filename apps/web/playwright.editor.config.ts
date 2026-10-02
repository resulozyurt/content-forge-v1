import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "./e2e",
    testMatch: "editor.spec.ts",
    timeout: 60_000,
    workers: 1,
    expect: { timeout: 15_000 },
    use: {
        baseURL: "http://localhost:3211",
        channel: process.platform === "win32" ? "chrome" : undefined,
        viewport: { width: 1440, height: 1000 },
        screenshot: "only-on-failure",
        trace: "retain-on-failure",
    },
    webServer: {
        command: "node node_modules/next/dist/bin/next dev --port 3211",
        url: "http://localhost:3211/en/editor-e2e.test",
        timeout: 120_000,
        reuseExistingServer: false,
        env: {
            NEXTAUTH_SECRET: "editor-test-secret-not-for-production",
            NEXTAUTH_URL: "http://localhost:3211",
            OPENAI_API_KEY: "test-placeholder",
            ANTHROPIC_API_KEY: "test-placeholder",
            RESEND_API_KEY: "re_test_placeholder",
            DATABASE_URL: "postgresql://test:test@127.0.0.1:1/test",
        },
    },
});
