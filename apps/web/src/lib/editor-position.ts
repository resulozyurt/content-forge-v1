type Rect = { left: number; right: number; top: number; bottom: number };

export function placeSelectionPopover(anchor: Rect, bounds: Rect, width: number, height: number) {
    const gap = 8;
    const top = Math.max(bounds.top, Math.min(anchor.top, bounds.bottom));
    const bottom = Math.min(bounds.bottom, Math.max(anchor.bottom, bounds.top));
    const below = bounds.bottom - bottom - gap;
    const above = top - bounds.top - gap;
    const fitsBelow = below >= height;
    const fitsAbove = above >= height;
    const useBelow = fitsBelow || (!fitsAbove && below >= above);
    const room = Math.max(0, useBelow ? below : above);
    // When the selection fills the view, show an overlapping, scrollable panel.
    const maxHeight = room >= 180 ? room : bounds.bottom - bounds.top;
    const visibleHeight = Math.min(height, maxHeight);
    const desiredTop = useBelow ? bottom + gap : top - visibleHeight - gap;
    return {
        left: Math.max(bounds.left, Math.min(anchor.left, bounds.right - width)),
        top: Math.max(bounds.top, Math.min(desiredTop, bounds.bottom - visibleHeight)),
        maxHeight,
    };
}
