import { describe, expect, it } from 'vitest';
import { themeTransitionAnimation } from './ui';

describe('theme transition direction', () => {
  const origin = { x: 20, y: 30 };
  const viewport = { width: 200, height: 100 };

  it('expands the new dark snapshot from the trigger', () => {
    const animation = themeTransitionAnimation('dark', origin, viewport);
    expect(animation.pseudoElement).toBe('::view-transition-new(root)');
    expect(animation.clipPath[0]).toBe('circle(0 at 20px 30px)');
    expect(animation.clipPath[1]).not.toBe(animation.clipPath[0]);
  });

  it('shrinks the old dark snapshot back into the trigger', () => {
    const animation = themeTransitionAnimation('light', origin, viewport);
    expect(animation.pseudoElement).toBe('::view-transition-old(root)');
    expect(animation.clipPath[0]).not.toBe('circle(0 at 20px 30px)');
    expect(animation.clipPath[1]).toBe('circle(0 at 20px 30px)');
  });

  it('uses the same motion curve in both directions', () => {
    expect(themeTransitionAnimation('light', origin, viewport).easing)
      .toBe(themeTransitionAnimation('dark', origin, viewport).easing);
  });
});
