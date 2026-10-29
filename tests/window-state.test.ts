import { describe, expect, it } from 'vitest';
import { parseWindowState } from '../src/main/windowState';

const screen = [{ x: 0, y: 0, width: 1920, height: 1040 }];
const min = { width: 960, height: 640 };

describe('window state', () => {
  it('starts maximized without (valid) saved state', () => {
    expect(parseWindowState(null, screen, min)).toEqual({ maximized: true, fullScreen: false });
    expect(parseWindowState('not json', screen, min)).toEqual({ maximized: true, fullScreen: false });
    expect(parseWindowState('42', screen, min)).toEqual({ maximized: true, fullScreen: false });
  });

  it('reopens a normal window with its size and position', () => {
    const json = JSON.stringify({ maximized: false, fullScreen: false, bounds: { x: 100, y: 50, width: 1200, height: 800 } });
    expect(parseWindowState(json, screen, min)).toEqual({
      maximized: false,
      fullScreen: false,
      bounds: { x: 100, y: 50, width: 1200, height: 800 },
    });
  });

  it('keeps maximized and full screen, with the normal size for un-maximizing', () => {
    const json = JSON.stringify({ maximized: true, fullScreen: true, bounds: { x: 10, y: 10, width: 1000, height: 700 } });
    expect(parseWindowState(json, screen, min)).toMatchObject({ maximized: true, fullScreen: true, bounds: { width: 1000 } });
  });

  it('drops a position that is no longer on any display', () => {
    const json = JSON.stringify({ maximized: false, bounds: { x: 2500, y: 100, width: 1200, height: 800 } });
    expect(parseWindowState(json, screen, min)).toEqual({ maximized: false, fullScreen: false });
    // A second monitor on the right makes it visible again.
    expect(parseWindowState(json, [...screen, { x: 1920, y: 0, width: 1920, height: 1040 }], min).bounds).toBeDefined();
  });

  it('grows a too-small saved window to the minimum size', () => {
    const json = JSON.stringify({ maximized: false, bounds: { x: 0, y: 0, width: 300, height: 200 } });
    expect(parseWindowState(json, screen, min).bounds).toEqual({ x: 0, y: 0, width: 960, height: 640 });
  });
});
