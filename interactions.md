# Tab Interactions — Native App Spec

**Prototype**: https://tabs-interactions.vercel.app/

## Try in the prototype

1. Click between tabs to see the activation animation (background rises + outer corners slide out)
2. Add a new tab, watch the multi-phase width + content reveal
3. Close a tab (both active and inactive), watch the collapse + mask + background fade
4. Hover inactive tabs, background and close button fade in
5. Drag a tab to reorder, siblings displace smoothly
6. Try long pressing a tab to activate the drag state without moving
7. Drag a tab horizontally, notice the drag is locked to the horizontal axis while attached
8. Drag a tab downward past the tab bar, feel the resistance building before it detaches into a new window
9. Drag a detached tab back over a window's tab bar, a hover preview expands to show where it will land
10. Drop the tab into another window, it attaches at the insertion point
11. Right-click a tab → Pin, watch the FLIP animation shrink it to icon-only
12. Right-click a pinned tab → Unpin, width restores with FLIP
13. Add many tabs until they compress, close button hides at ≤60px
14. Close the last tab in a window, the window scales down and disappears
15. Drag a window by its title bar, resize from edges and corners
16. Toggle "New tab creation" between "Next to active" and "At the end", then add tabs to see the difference
17. Use the slowdown slider to review any animation at up to 12x

---

## Doc/Spec

## 1. Tab Activation

- Clicking an inactive tab makes it active
- Only one tab is active at a time per window
- Dragging an inactive tab does **not** activate it

**Active tab visual state**:
- Tab background becomes visible (see section 6)
- Close button always visible
- Label fade region widens to `40px`, close button gap grows to `20px`

**Inactive tab visual state**:
- Tab background hidden (fully transparent, shifted down 8px, scaled to 0.92)
- Close button hidden (fully transparent)
- Label fade region: `12px`, close button gap: `0px`

## 2. Tab Creation

- Add button creates a new tab, which auto-activates immediately
- Tab is inserted at zero width and zero padding, then animates open

**Insertion position** (configurable via demo toggle):
- **Next to active** (default): new tab is inserted immediately after the currently active tab
- **At the end**: new tab is appended at the end of the tab list (before the add button)

**Favicon loading**: the entrance animation is deferred until the tab's favicon has been decoded and is ready to render, preventing a flash of empty icon space.

**Multi-phase entrance animation** (total duration: 250ms, easing: ease):

1. **Width expansion** (full duration): width animates from `0px` to natural measured width; horizontal padding animates from `0px` to resting values
2. **Content reveal** (last 30% of duration): a gradient mask sweeps from right to left (`80px` → `0px`), progressively revealing the label
3. **Background fade-in** (full duration): opacity `0` → `1`
4. **Close button entrance** (70% duration, 30% delay): fades in from transparent and scales from `0.8` → `1.0`

On finish: size constraints released, mask cleared, transitions re-enabled.

## 3. Tab Close

- Close button visible on hover (inactive tabs) or always (active tab)
- Pinned tabs cannot be closed via close button

**Multi-phase exit animation** (total duration: 250ms, easing: ease):

1. **Width collapse** (full duration): width and horizontal padding animate down to `0px`
2. **Content mask** (first 30% of duration): gradient mask sweeps from left to right (`0px` → `80px`), progressively hiding the label
3. **Background fade-out** (full duration, only if active tab): opacity `1` → `0`
4. **Close button exit** (first 50% of duration): fades out and scales from `1.0` → `0.8`

**Behavioral rules**:
- Closing the active tab auto-activates the nearest neighbor (next tab, or previous if last)
- Closing the last tab in a window closes that entire window (see section 13)
- Tab is destroyed once the width animation finishes

## 4. Hover States

All hover transitions: 150ms ease.

**Inactive tab hover**:
- A full-bleed background layer fades in to full opacity
- Close button fades in to full opacity
- Label fade region widens: `12px` → `40px`
- Close button gap expands: `0px` → `20px`

**Close button hover**:
- Background fill fades in (150ms ease)
- Size: `20px × 20px`, corner radius: `4px` (default) / `6px` (on active tab)

**Add button hover**:
- Background fill fades in (150ms ease)
- Size: `32px × 32px`, corner radius: `8px`

**Window control hover**:
- Dims slightly via brightness reduction to `0.92` (150ms ease)
- Pressed state: scales down to `0.94`

## 5. Tab Drag & Reorder

**Drag initiation** (two paths):
- **Movement threshold**: pointer moves ≥ `3px` from initial position
- **Long press**: `300ms` hold without release (scaled by motion factor)

**Drag proxy**:
- A visual clone of the tab is created and follows the pointer in real-time
- The original tab becomes invisible (stays in layout to hold its slot)
- Pointer capture is acquired so the drag continues even if the pointer leaves the tab bar
- All non-dragged tabs become non-interactive during the drag

**Sibling displacement**:
- As the proxy moves, the insertion index is recalculated from pointer position
- Trigger threshold: `10%` of a tab's width from the leading edge (direction-aware — `10%` when moving right, `90%` when moving left, `50%` when stationary)
- Displaced siblings slide horizontally to make room, then slide back when the proxy moves away
- Duration: 150ms, easing: ease
- Movements smaller than `0.5px` are skipped

**Pinned boundary**: pinned and unpinned tabs occupy separate zones; reordering cannot cross the boundary.

**Drop settle**:
- On release, the proxy animates from its current position to the target slot
- Duration: 150ms, easing: ease
- If the distance is less than `0.5px`, it snaps instantly

## 6. Tab Background & Outer Corners

The tab background and its outer corners work together as a single visual unit during activation.

**Tab background**:
- **Inactive**: fully transparent, shifted down `8px`, scaled to `0.92` (anchored at bottom center)
- **Active**: fully opaque, returns to natural position and full scale — rises up and expands into place
- Corner radius: `12px` on top two corners, `0` on bottom (flush with tab bar)
- Transition: 150ms ease on both opacity and position/scale

**Outer corners** (inverse rounding):
- 12×12px SVG elements with a quarter-circle vector path, positioned at the bottom-left and bottom-right just outside the tab background
- These create the visual effect of the tab bar surface curving smoothly into the active tab
- **Inactive**: fully transparent, translated inward (tucked behind the tab, hidden)
- **Active**: fully opaque, slide outward `12px` into their natural position as the background rises
- Transition: 150ms ease on both opacity and horizontal position

The combined effect: the background fades in while rising and scaling up from the bottom, and the outer corners simultaneously slide out from behind the tab edges — all in one coordinated 150ms motion.

**During drag**:
- Outer corners animate out (slide inward + fade, 150ms) so the tab looks like a standalone card
- On drop / reattach, they animate back in

## 7. Drag Visual Effects

**Shadow**:
- On drag start: a subtle elevation shadow fades in (150ms ease)
- On drop: the shadow fades out (50ms ease)
- Shadow is applied to the tab background for active tabs, or to a background overlay for inactive tabs

**Corner radius morph**:
- Attached state: top two corners rounded at `12px`, bottom corners at `0` (flush with tab bar)
- Detached state: all four corners rounded at `12px` (standalone card)
- Duration: 150ms, easing: ease

## 8. Tab Detach (Tear-off)

**Boundary resistance**:
- Resistance begins `12px` before the tab bar edge (onset inset)
- Resistance factor: `0.22` — for every pixel of overshoot, only `0.22px` of visual movement
- Maximum resistance displacement: `±32px`

**Overshoot detection**:
- Detach triggers at `80px` of overshoot beyond the resistance onset
- Reattach arms when overshoot drops below `40px` (50% of detach threshold)

**Detach transition**:
- Corrects the visual position from the resisted state to the actual pointer position
- Uses a cubic-bezier curve (`0.25, 0.1, 0.25, 1.0`) for smooth deceleration
- Duration: 150ms
- The correction decays over the animation: starts at full offset, eases to zero

**Placeholder collapse**:
- The gap left behind in the tab bar smoothly collapses to zero width
- Duration: 150ms, easing: ease
- Re-entering the header expands the placeholder back

**New window creation**:
- A new window spawns at the tab's anchor point (tab center horizontally, tab bottom vertically as the animation origin)
- Scales from `0.6` → `1.0` while fading from transparent to fully opaque
- Duration: 250ms, easing: ease

## 9. Cross-Window Drag (Attach)

- Dragging a detached tab over another window's tab bar creates a **hover preview** at the calculated insertion index
- The hovered window is brought to front
- The preview expands from zero width to the target tab width, easing: ease
- The dragged proxy's width syncs to match the preview slot
- Movements smaller than `0.5px` are skipped
- **Drop**: attaches the tab at the insertion index, proxy settles to final position
- **Leave**: preview collapses back to zero, tab returns to detached state
- **Hit detection padding**: `12px` from window edges
- **Fallback detection radius**: `48px` for hover attach

## 10. Pin / Unpin

Available via context menu (right-click / secondary click).

**Pin** — FLIP animation:
1. Measure all tab positions (before state)
2. Move tab to the pinned section
3. Measure all tab positions again (after state)
4. Animate each displaced tab from its old position to its new position via horizontal slide
5. The pinned tab also animates its width from the before-width to icon-only minimum
6. Duration: 150ms, easing: ease
7. Movements smaller than `0.5px` are skipped

**Unpin** — same animation in reverse: width restores, tab moves back to unpinned section.

## 11. Context Menu

- Triggered by right-click / secondary click on a tab
- Positioned at pointer coordinates
- Options: **Pin tab** / **Unpin tab** (toggled based on current state)
- Minimum width: `160px`, corner radius: `6px`
- Item font size: `13px`, item padding: `6px 12px`
- Dismisses on outside click or Escape key

## 12. Tab Compression

- Tab width is continuously monitored
- When width ≤ `60px`: the tab enters narrow mode
- When width > `60px`: the tab exits narrow mode

**Narrow mode behavior**:
- Close button hidden to preserve label readability
- Close button reappears on hover even in narrow mode (for active/hovered tab)

## 13. Window Chrome

**Title bar drag**:
- Drag initiated on pointer down in non-interactive header areas
- Cursor changes to a grab hand while idle, grabbing hand during drag
- Pointer capture acquired during drag
- Position updated in real-time

**8-direction resize**:
- Hit detection zone: `10px` from edges
- Appropriate resize cursors for each direction (horizontal, vertical, diagonal)
- Minimum constraints: width `120px`, height `80px`

**Window close**:
- Close button triggers animated removal
- Animation origin: the close button's position
- Scales from `1.0` → `0.6` while fading from opaque to transparent
- Duration: 250ms, easing: ease

**Empty window auto-close**:
- Removing the last tab triggers the same window removal animation
- Animation origin: the tab's close button position

## 14. Close Suppression

- When a narrow (≤60px) inactive tab becomes active, the close button would suddenly appear under the pointer
- To prevent accidental clicks, the close button is temporarily suppressed
- Suppression is removed once the pointer leaves the tab
- This acts as a flicker guard — the close button only becomes interactive after the pointer re-enters intentionally

## 15. Motion Control (Demo Tool)

- Global slowdown slider scales all animation durations from `1x` to `12x`
- All animations in the prototype respect this multiplier

## 16. Tab Creation Position (Demo Tool)

- Toggle switches between **Next to active** and **At the end**
- Controls where newly created tabs are inserted (see section 2)

Both demo tools are for review and presentation purposes only — not shipping features.

---

## Animation Defaults

| Property              | Duration | Easing                                                            |
| --------------------- | -------- | ----------------------------------------------------------------- |
| Tab create/close      | 250ms    | ease                                                              |
| Sibling displacement  | 150ms    | ease                                                              |
| Drag proxy settle     | 150ms    | ease                                                              |
| Shadow in             | 150ms    | ease                                                              |
| Shadow out            | 50ms     | ease                                                              |
| Corner clip           | 150ms    | ease                                                              |
| Detach correction     | 150ms    | cubic-bezier(0.25, 0.1, 0.25, 1.0) Due to resistance calculation |
| Window spawn/remove   | 250ms    | ease                                                              |
| Pin/Unpin FLIP        | 150ms    | ease                                                              |
| All hover transitions | 150ms    | ease                                                              |

All durations are subject to the global motion factor for demo purposes.
