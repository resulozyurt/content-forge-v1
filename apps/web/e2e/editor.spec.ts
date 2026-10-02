import { test, expect, type Page, type Route } from "@playwright/test";

type Saved = { id: string; outputContent: string; inputPayload: object; updatedAt: string };
async function setup(page: Page) {
    page.on("pageerror", error => console.error("Browser error:", error.message));
    const state = {
        saved: undefined as Saved | undefined, writes: [] as Record<string, unknown>[],
        failSave: false, delaySave: false, release: null as (() => void) | null,
        edit: null as Record<string, unknown> | null, editResult: "A clear new plan helps your team.",
        image: "", failImage: false, delayEdit: false, releaseEdit: null as (() => void) | null,
    };
    await page.route("**/api/**", async (route: Route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/auth/session") return route.fulfill({ json: {} });
        if (path === "/api/documents/history") return route.fulfill({ json: { jobs: state.saved ? [state.saved] : [] } });
        if (path === "/api/documents/save") {
            const body = route.request().postDataJSON();
            state.writes.push(body);
            if (state.delaySave) await new Promise<void>(resolve => { state.release = resolve; });
            if (state.failSave) return route.fulfill({ status: 500, json: { message: "Test save failure. Please retry." } });
            const revision = new Date(Date.now() + state.writes.length).toISOString();
            state.saved = { id: body.documentId, outputContent: body.content, inputPayload: body.inputData, updatedAt: revision };
            return route.fulfill({ json: { documentId: body.documentId, revision } });
        }
        if (path === "/api/v2/generator/edit") {
            state.edit = route.request().postDataJSON();
            if (state.delayEdit) await new Promise<void>(resolve => { state.releaseEdit = resolve; });
            return route.fulfill({ json: { result: state.editResult } });
        }
        if (path === "/api/v2/generator/image-generate") return route.fulfill({
            status: state.failImage ? 502 : 200,
            json: state.failImage ? { error: "Test image failure" } : { imageDataUri: state.image },
        });
        return route.fulfill({ status: 501, json: { error: "Unexpected test API request: " + path } });
    });
    await page.goto("/en/editor-e2e.test");
    await expect(page.locator(".tiptap")).toBeVisible();
    await expect(page.getByText("Saved to History", { exact: true })).toBeVisible();
    return state;
}

async function selectParagraph(page: Page, index = 0) {
    await page.locator(".tiptap > p").nth(index).evaluate(node => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const selection = window.getSelection()!;
        selection.removeAllRanges(); selection.addRange(range);
        (node.closest("[contenteditable]") as HTMLElement).focus();
        document.dispatchEvent(new Event("selectionchange"));
    });
    await page.getByRole("button", { name: "Edit selection with AI", exact: true }).click();
}

test("prompt preview applies only the selection and survives a History reopen with exports and colored links", async ({ page }) => {
    const state = await setup(page);
    const originalId = state.saved!.id;
    await selectParagraph(page);
    await page.getByLabel("Your instructions").fill("Explain this in simple terms.");
    await page.getByRole("button", { name: "Generate", exact: true }).click();
    await expect(page.getByLabel("Generated text preview")).toContainText(state.editResult);
    expect(state.edit?.prompt).toBe("Explain this in simple terms.");
    await expect(page.locator(".tiptap")).toContainText("Our team can help");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.locator(".tiptap")).toContainText(state.editResult);
    await expect(page.locator(".tiptap a")).toHaveAttribute("href", "https://example.com/guide");
    await expect(page.getByText("Saved to History", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Open saved article from History" }).click();
    await expect(page.locator(".tiptap")).toContainText(state.editResult);
    expect(state.saved!.id).toBe(originalId);
    await expect(page.getByRole("button", { name: "Export Word" })).toBeEnabled();
    await expect(page.locator(".tiptap a")).toHaveCSS("text-decoration-line", "underline");
    await expect(page.locator(".tiptap a")).toHaveCSS("color", "rgb(37, 99, 235)");
    await selectParagraph(page);
    await expect(page.getByLabel("Your instructions")).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("editor-history.png"), fullPage: true });
});

test("new image and its prompt survive History, and failed generation preserves the old image", async ({ page }) => {
    const state = await setup(page);
    state.image = await page.evaluate(() => {
        const canvas = document.createElement("canvas"); canvas.width = 160; canvas.height = 80;
        const ctx = canvas.getContext("2d")!; ctx.fillStyle = "red"; ctx.fillRect(0, 0, 160, 80);
        return canvas.toDataURL();
    });
    const old = await page.locator(".tiptap img[src]").getAttribute("src");
    await page.locator(".tiptap img[src]").click();
    await page.getByRole("button", { name: "Regenerate image", exact: true }).click();
    await page.getByLabel("Your instructions").fill("A bright red scene.");
    state.failImage = true;
    await page.getByRole("button", { name: "Generate", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Test image failure" })).toBeVisible();
    await expect(page.locator(".tiptap img[src]")).toHaveAttribute("src", old!);
    state.failImage = false;
    await page.getByRole("button", { name: "Generate", exact: true }).click();
    await expect(page.locator(".tiptap img[src]")).toHaveAttribute("src", state.image);
    await expect(page.getByText("Saved to History", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Open saved article from History" }).click();
    await expect(page.locator(".tiptap img[src]")).toHaveAttribute("src", state.image);
    await page.locator(".tiptap img[src]").click();
    await page.getByRole("button", { name: "Regenerate image", exact: true }).click();
    await expect(page.getByLabel("Your instructions")).toHaveValue("A bright red scene.");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export Word" }).click();
    expect((await download).suggestedFilename()).toMatch(/\.docx$/);
});

test("a pending rewrite cannot overwrite newer edits", async ({ page }) => {
    const state = await setup(page);
    state.delayEdit = true;
    await selectParagraph(page);
    await page.getByLabel("Your instructions").fill("Make it short.");
    await page.getByRole("button", { name: "Generate", exact: true }).click();
    await expect.poll(() => !!state.releaseEdit).toBe(true);
    await page.locator(".tiptap").press("Control+End");
    await page.locator(".tiptap").press("Enter");
    await page.keyboard.insertText("A newer manual edit.");
    state.releaseEdit!();
    await expect(page.getByRole("status").filter({ hasText: "article changed while generating" })).toBeVisible();
    await expect(page.locator(".tiptap")).toContainText("A newer manual edit.");
    await expect(page.locator(".tiptap")).not.toContainText(state.editResult);
});

test("autosave serializes edits, retries failures, and keeps one History document", async ({ page }) => {
    const state = await setup(page);
    const originalId = state.saved!.id;
    state.delaySave = true;
    await page.locator(".tiptap").press("Control+End");
    await page.locator(".tiptap").press("Enter");
    await page.keyboard.insertText("First edit.");
    await expect.poll(() => !!state.release).toBe(true);
    await page.keyboard.insertText(" Second edit.");
    const writesBefore = state.writes.length;
    await page.waitForTimeout(1100);
    expect(state.writes.length).toBe(writesBefore);
    state.delaySave = false; state.release!();
    await expect(page.getByText("Saved to History", { exact: true })).toBeVisible();
    expect(state.saved!.outputContent).toContain("Second edit.");
    expect(state.saved!.id).toBe(originalId);
    expect(state.writes.at(-1)?.create).toBe(false);
    state.failSave = true;
    await page.keyboard.insertText(" Third edit.");
    await expect(page.getByRole("alert").filter({ hasText: "Test save failure" })).toBeVisible();
    await expect(page.getByText("Saved to History", { exact: true })).not.toBeVisible();
    state.failSave = false;
    await page.getByRole("button", { name: "Save now", exact: true }).click();
    await expect(page.getByText("Saved to History", { exact: true })).toBeVisible();
    expect(state.saved!.outputContent).toContain("Third edit.");
});

test("readability responds to edits and undo; language selection survives History", async ({ page }) => {
    await setup(page);
    const editor = page.locator(".tiptap > p").first();
    await editor.fill(Array(8).fill("We help teams build clear plans").join(" ") + ".");
    await expect(page.getByTestId("score-change")).toBeVisible();
    const before = await page.getByTestId("score-change").textContent();
    await page.waitForTimeout(600); // Separate manual typing undo groups.
    await editor.fill(Array(8).fill("We help teams build clear plans.").join(" "));
    await expect(page.getByTestId("score-change")).not.toHaveText(before!);
    await expect(page.getByTestId("score-change")).toContainText("+");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.getByTestId("score-change")).toContainText("-");
    await page.getByLabel("Article language").selectOption("tr");
    await expect(page.getByText("Ateşman Okunabilirlik", { exact: true })).toBeVisible();
    await expect(page.getByText("Saved to History", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Open saved article from History" }).click();
    await expect(page.getByLabel("Article language")).toHaveValue("tr");
});


test("rewriting linked text rejects lost links, then applies a safe retry", async ({ page }) => {
    const state = await setup(page);
    await selectParagraph(page, 1);
    await page.getByLabel("Your instructions").fill("Make this more inviting and keep the link.");
    await page.getByRole("button", { name: "Generate", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "changed an existing link" })).toBeVisible();
    await expect(page.locator(".tiptap a")).toHaveAttribute("href", "https://example.com/guide");
    state.editResult = String(state.edit!.text).replace("Read our", "Explore our");
    await page.getByRole("button", { name: "Generate", exact: true }).click();
    await expect(page.getByLabel("Generated text preview")).toContainText("Explore our");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.locator(".tiptap")).toContainText("Explore our");
    await expect(page.locator(".tiptap a")).toHaveAttribute("href", "https://example.com/guide");
});
