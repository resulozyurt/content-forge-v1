import test from "node:test";
import assert from "node:assert/strict";
import { placeSelectionPopover } from "./editor-position";

const bounds = { left: 24, right: 700, top: 100, bottom: 800 };
test("selection popover stays beside text and flips above near the bottom", () => {
    const below = placeSelectionPopover({ left: 150, right: 500, top: 300, bottom: 330 }, bounds, 440, 250);
    assert.equal(below.top, 338);
    assert.equal(below.left, 150);
    const above = placeSelectionPopover({ left: 600, right: 650, top: 740, bottom: 780 }, bounds, 440, 250);
    assert.equal(above.top, 482);
    assert.equal(above.left, 260);
});
test("a view-filling image keeps the scrollable panel inside visible bounds", () => {
    const placement = placeSelectionPopover({ left: 10, right: 710, top: -300, bottom: 1500 }, bounds, 440, 700);
    assert.equal(placement.top, bounds.top);
    assert.equal(placement.left, bounds.left);
    assert.equal(placement.maxHeight, 700);
});
test("narrow viewports clamp the panel horizontally", () => {
    const narrow = { left: 12, right: 378, top: 90, bottom: 700 };
    const placement = placeSelectionPopover({ left: 340, right: 378, top: 300, bottom: 340 }, narrow, 366, 240);
    assert.equal(placement.left, 12);
    assert.ok(placement.top >= narrow.top && placement.top + 240 <= narrow.bottom);
});
