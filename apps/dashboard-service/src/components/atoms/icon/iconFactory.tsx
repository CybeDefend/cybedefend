import React, { forwardRef, useId } from 'react';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';

export interface IconProps extends Omit<React.SVGProps<SVGSVGElement>, 'ref'> {
  /** Edge length in px. Matches lucide's `size`, so one prop fits both vendors. */
  size?: number | string;
  /**
   * Widens the stroke on a lucide glyph; accepted and ignored on a FontAwesome
   * one, which is a solid shape with no stroke. Call sites pass it either way,
   * and React would otherwise render it as a dead attribute.
   */
  strokeWidth?: number | string;
  /**
   * Accessible name. Rendered as an SVG `<title>` and wired via aria-labelledby,
   * which also un-hides the icon from assistive tech — an icon carrying a title
   * is meaningful, not decorative.
   */
  title?: string;
}

/**
 * Kebab-cased registry name, stamped on every icon as `cybe-icon-<name>`.
 *
 * The class belongs to us, not to whichever vendor drew the glyph, and that is
 * the point: styling and test selectors hang off the registry name, so moving a
 * name between vendors is invisible to them. Leaking `lucide-*` into selectors
 * is what used to make an icon swap break unrelated tests.
 */
const registryClass = (name: string, className?: string): string => {
  const slug = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  return ['cybe-icon', `cybe-icon-${slug}`, className].filter(Boolean).join(' ');
};

/**
 * Renders a FontAwesome icon definition as a plain `<svg>`, under lucide's props.
 *
 * FontAwesome and lucide are the two vendors the app has always drawn with, and
 * the mix is deliberate: `icons.tsx` sends each name back to the vendor that
 * name came from, so a call site gets the glyph it always had. What the vendors
 * never shared was an API — FontAwesome went through `<FontAwesomeIcon
 * icon={faBug} />`, lucide through `<Bug size={16} />`. Settling on lucide's
 * shape for both is what lets the call sites stay untouched.
 *
 * Rendering the path directly rather than through `@fortawesome/react-fontawesome`
 * keeps that runtime dependency out: the definition already carries the geometry,
 * and the component around it is this file.
 *
 * `size` defaults to `1em` — FontAwesome's own sizing, where an icon scales with
 * the text it sits in. Call sites that size with `w-4 h-4` override it, and a
 * non-square glyph in a square box is scaled to fit, never stretched.
 */
export const createFaIcon = (
  name: string,
  definition: IconDefinition,
): React.ForwardRefExoticComponent<IconProps & React.RefAttributes<SVGSVGElement>> => {
  const [width, height, , , pathData] = definition.icon;
  const paths = Array.isArray(pathData) ? pathData : [pathData];

  const Icon = forwardRef<SVGSVGElement, IconProps>(
    ({ size = '1em', strokeWidth: _ignoredStrokeWidth, title, className, ...rest }, ref) => {
      const generatedId = useId();
      const titleId = title ? `${name}-${generatedId}` : undefined;
      return (
        <svg
          ref={ref}
          xmlns="http://www.w3.org/2000/svg"
          className={registryClass(name, className)}
          width={size}
          height={size}
          viewBox={`0 0 ${width} ${height}`}
          fill="currentColor"
          role={title ? 'img' : undefined}
          aria-hidden={title ? undefined : true}
          aria-labelledby={titleId}
          focusable="false"
          {...rest}
        >
          {title ? <title id={titleId}>{title}</title> : null}
          {paths.map((d, i) => (
            <path key={i} d={d} fill="currentColor" />
          ))}
        </svg>
      );
    },
  );

  Icon.displayName = name;
  return Icon;
};

/**
 * Adopts a lucide component into the registry.
 *
 * lucide already speaks these props, so the wrapper exists for one reason: to
 * stamp the registry class, the same one FontAwesome glyphs carry. Without it
 * the app would select icons two different ways depending on who drew them.
 */
export const createLucideIcon = (
  name: string,
  Vendor: React.ComponentType<IconProps & React.RefAttributes<SVGSVGElement>>,
): React.ForwardRefExoticComponent<IconProps & React.RefAttributes<SVGSVGElement>> => {
  const Icon = forwardRef<SVGSVGElement, IconProps>(({ className, ...rest }, ref) => (
    <Vendor ref={ref} className={registryClass(name, className)} {...rest} />
  ));

  Icon.displayName = name;
  return Icon;
};
