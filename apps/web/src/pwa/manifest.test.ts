import { describe, expect, it } from 'vitest';
import { manifest } from './manifest';

describe('the installable manifest', () => {
  it('installs as a standalone portrait app', () => {
    expect(manifest.display).toBe('standalone');
    expect(manifest.orientation).toBe('portrait');
    expect(manifest.scope).toBe('/');
    expect(manifest.start_url).toBe('/');
  });

  it('ships both a maskable and a plain icon at 512', () => {
    const icons = manifest.icons ?? [];
    expect(icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'maskable')).toBe(true);
    expect(icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'any')).toBe(true);
    expect(icons.some((icon) => icon.sizes === '192x192')).toBe(true);
  });

  it('speaks British English and paints the brand background on the splash', () => {
    expect(manifest.lang).toBe('en-GB');
    expect(manifest.background_color).toBe('#215E49');
  });
});
