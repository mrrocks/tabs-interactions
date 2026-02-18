import { describe, expect, it } from 'vitest';
import {
  clampFrameToViewport,
  getDraggedFrame,
  getResizeCursor,
  getResizeDirection,
  getResizedFrame
} from './panelResize';

const baseState = {
  startX: 200,
  startY: 160,
  startWidth: 280,
  startHeight: 180,
  startLeft: 100,
  startTop: 80
};

describe('getResizedFrame', () => {
  it('resizes from bottom-right using pointer delta', () => {
    const nextFrame = getResizedFrame({
      ...baseState,
      direction: 'se',
      clientX: 260,
      clientY: 220,
      minWidth: 120,
      minHeight: 80
    });

    expect(nextFrame).toEqual({
      width: 340,
      height: 240,
      left: 100,
      top: 80
    });
  });

  it('respects minimum size and updates anchor for top-left', () => {
    const nextFrame = getResizedFrame({
      ...baseState,
      direction: 'nw',
      clientX: 500,
      clientY: 500,
      minWidth: 120,
      minHeight: 80
    });

    expect(nextFrame).toEqual({
      width: 120,
      height: 80,
      left: 260,
      top: 180
    });
  });

  it('resizes from right edge without changing top or left', () => {
    const nextFrame = getResizedFrame({
      ...baseState,
      direction: 'e',
      clientX: 260,
      clientY: 500,
      minWidth: 120,
      minHeight: 80
    });

    expect(nextFrame).toEqual({
      width: 340,
      height: 180,
      left: 100,
      top: 80
    });
  });

  it('keeps east resize inside the viewport', () => {
    const nextFrame = getResizedFrame({
      ...baseState,
      direction: 'e',
      clientX: 800,
      clientY: 200,
      minWidth: 120,
      minHeight: 80,
      viewportWidth: 320,
      viewportHeight: 500
    });

    expect(nextFrame).toEqual({
      width: 220,
      height: 180,
      left: 100,
      top: 80
    });
  });

  it('keeps west resize inside the viewport', () => {
    const nextFrame = getResizedFrame({
      ...baseState,
      direction: 'w',
      clientX: -200,
      clientY: 200,
      minWidth: 120,
      minHeight: 80,
      viewportWidth: 600,
      viewportHeight: 500
    });

    expect(nextFrame).toEqual({
      width: 380,
      height: 180,
      left: 0,
      top: 80
    });
  });
});

describe('getResizeDirection', () => {
  const rect = {
    left: 100,
    top: 80,
    right: 380,
    bottom: 260
  };

  it('detects corners first', () => {
    expect(getResizeDirection({ clientX: 103, clientY: 83, rect, hitArea: 8 })).toBe('nw');
    expect(getResizeDirection({ clientX: 377, clientY: 257, rect, hitArea: 8 })).toBe('se');
  });

  it('detects edges when not in corners', () => {
    expect(getResizeDirection({ clientX: 240, clientY: 82, rect, hitArea: 8 })).toBe('n');
    expect(getResizeDirection({ clientX: 379, clientY: 160, rect, hitArea: 8 })).toBe('e');
    expect(getResizeDirection({ clientX: 180, clientY: 259, rect, hitArea: 8 })).toBe('s');
    expect(getResizeDirection({ clientX: 101, clientY: 160, rect, hitArea: 8 })).toBe('w');
  });
});

describe('getResizeCursor', () => {
  it('maps directions to expected cursor values', () => {
    expect(getResizeCursor('nw')).toBe('nwse-resize');
    expect(getResizeCursor('ne')).toBe('nesw-resize');
    expect(getResizeCursor('n')).toBe('ns-resize');
    expect(getResizeCursor('w')).toBe('ew-resize');
    expect(getResizeCursor(null)).toBe('default');
  });
});

describe('getDraggedFrame', () => {
  it('clamps dragging to viewport limits', () => {
    const nextFrame = getDraggedFrame({
      startX: 200,
      startY: 160,
      startLeft: 100,
      startTop: 80,
      clientX: 600,
      clientY: 500,
      width: 280,
      height: 180,
      viewportWidth: 360,
      viewportHeight: 240
    });

    expect(nextFrame).toEqual({
      left: 80,
      top: 60
    });
  });
});

describe('clampFrameToViewport', () => {
  it('clamps an out-of-bounds frame after viewport shrink', () => {
    const nextFrame = clampFrameToViewport({
      width: 500,
      height: 300,
      left: 120,
      top: 90,
      minWidth: 120,
      minHeight: 80,
      viewportWidth: 320,
      viewportHeight: 220
    });

    expect(nextFrame).toEqual({
      width: 320,
      height: 220,
      left: 0,
      top: 0
    });
  });
});
