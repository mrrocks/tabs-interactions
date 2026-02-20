# Tab Interactions — Native App Spec

## 1. Tab Activation
- Clicking an inactive tab makes it active
- Active tab gets distinct visual treatment (elevated background, different fill)
- Only one tab is active at a time per window
- Dragging an inactive tab does **not** activate it

## 2. Tab Creation
- Add button appends a new tab, which auto-activates
- Multi-phase entrance animation:
  - Width expands from 0 to natural size (250ms)
  - Content reveals via gradient mask (first 30% of duration)
  - Tab background fades in (full duration)
  - Close button scales + fades in (last 70%, delayed 30%)
- Sibling tabs shift smoothly to accommodate

## 3. Tab Close
- Close button on each tab (visible on hover or when active)
- Multi-phase exit animation:
  - Width collapses to 0 (including padding)
  - Content masks out (first 30% of duration)
  - Background fades out (if active tab)
  - Close button scales down (first 50%)
- Sibling tabs shift to fill the gap
- Closing the active tab auto-activates the nearest neighbor
- Closing the last tab in a window closes that window

## 4. Hover States
- Inactive tab hover: subtle background fill, close button fades in, label fade region widens
- Close button hover: background + icon color shift
- Add button hover: background + icon color shift
- Window control hover: brightness + slight scale transform
- All hover transitions: 150ms ease

## 5. Tab Drag & Reorder
- Drag initiates on pointer down + movement threshold **or** long press
- Dragging creates a visual proxy that follows the pointer
- Sibling tabs displace with translate animations (150ms ease) to show insertion point
- Insertion index recalculated in real-time from pointer position
- Pinned tabs form a boundary — unpinned tabs cannot cross into pinned zone and vice versa
- On drop, proxy settles to final position (150ms ease)
- Pointer events disabled on non-dragged elements during drag

## 6. Drag Visual Effects
- **Corner clip**: tab background corner pseudo-elements slide in/out (12px translation) on drag start/end
- **Shadow**: box-shadow fades in on drag start (150ms), fades out on drop (100ms)
- **Background radius**: corners morph between attached (rounded-top) and detached (fully rounded) states

## 7. Tab Detach (Tear-off)
- Dragging a tab beyond the tab bar boundary triggers detach
- **Boundary resistance**: cubic-bezier resistance curve as the tab approaches the edge — it doesn't just pop off, it resists first
- **Overshoot detection**: measures drag intent beyond the resistance zone to confirm detach
- **Detach transition**: resistance correction animation (cubic-bezier, 150ms decay)
- **Placeholder collapse**: the gap left behind animates closed
- **New window creation**: a new window spawns at the tab's anchor point with scale 0.6→1.0 + opacity 0→1 (180ms)

## 8. Cross-Window Drag (Attach)
- Dragging a tab over another window's tab bar creates a hover preview (width expands from 0)
- Hovered window comes to front (z-order)
- Proxy width syncs to match the preview slot
- Dropping attaches the tab at the calculated insertion index
- Leaving the target window collapses the preview and the tab returns to detached state

## 9. Pin / Unpin
- Available via context menu (right-click / secondary click)
- **Pin**: tab moves to the pinned section with a FLIP animation
  - Width shrinks to icon-only minimum
  - All affected tabs reposition via translate (150ms)
- **Unpin**: reverses — width restores, tab moves back to unpinned section

## 10. Context Menu
- Right-click / secondary click on a tab shows a context menu
- Options: Pin / Unpin
- Dismisses on outside click or Escape

## 11. Tab Compression
- As tabs shrink (overflow), tabs reaching ≤60px width enter narrow mode
- Narrow mode: close button hidden to preserve label readability
- Close button reappears on hover even in narrow mode (for active/hovered tab)

## 12. Window Chrome
- **Title bar drag**: drag window by non-interactive header areas
- **8-direction resize**: edge and corner hit zones (10px padding), with appropriate cursors
- **Minimum size constraints** enforced during resize
- **Window close button**: triggers scale 1.0→0.6 + opacity out (180ms)
- **Empty window auto-close**: removing the last tab animates the window away

## 13. Close Suppression
- When rapidly switching active tabs, close button visibility is temporarily suppressed to prevent accidental clicks (flicker guard)

## 14. Motion Control (Demo Tool)
- Global slowdown slider: scales all animation durations from 1x to 12x
- For review and presentation purposes only — not a shipping feature

---

## Animation Defaults

| Property | Duration | Easing |
|---|---|---|
| Tab create/close | 250ms | ease |
| Sibling displacement | 150ms | ease |
| Drag proxy settle | 150ms | ease |
| Shadow in | 150ms | ease |
| Shadow out | 100ms | ease |
| Corner clip | 150ms | ease |
| Detach correction | 150ms | cubic-bezier(0.25, 0.1, 0.25, 1.0) |
| Window spawn/remove | 180ms | ease |
| Pin/Unpin FLIP | 150ms | ease |
| All hover transitions | 150ms | ease |

All durations are subject to the global motion factor for demo purposes.
