"use client";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { ChevronDown, Code, FileText, Download, Loader2 } from "lucide-react";
import { editorSecondary } from "./editor-ui";

export default function EditorExportMenu({ copyHtml, copyMarkdown, exportWord, exporting, empty }: {
    copyHtml: () => void; copyMarkdown: () => void; exportWord: () => void; exporting: boolean; empty: boolean;
}) {
    return <Menu>
        <MenuButton className={editorSecondary} disabled={exporting} aria-busy={exporting}>
            {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            {exporting ? "Exporting..." : "Export"}<ChevronDown size={14} />
        </MenuButton>
        <MenuItems anchor="bottom end" className="z-[70] w-56 rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl [--anchor-gap:8px] focus:outline-none dark:border-gray-700 dark:bg-gray-900">
            {[
                { label: "Copy HTML", icon: Code, onClick: copyHtml },
                { label: "Copy as MD", icon: FileText, onClick: copyMarkdown },
                { label: "Export Word", icon: Download, onClick: exportWord },
            ].map(({ label, icon: Icon, onClick }) => <MenuItem key={label} disabled={empty}>
                <button onClick={onClick} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-gray-700 data-focus:bg-indigo-50 data-focus:text-indigo-600 data-disabled:opacity-50 dark:text-gray-200 dark:data-focus:bg-indigo-500/15 dark:data-focus:text-indigo-300">
                    <Icon size={16} className="text-indigo-500" />{label}
                </button>
            </MenuItem>)}
        </MenuItems>
    </Menu>;
}
