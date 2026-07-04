import art from "../lib/illustrations.json";

// Renders the per-commodity SVG illustration. Each SVG is self-contained with
// its own <defs> gradients (id-prefixed to avoid collisions). We inject via
// dangerouslySetInnerHTML because the SVGs are static, hand-designed strings
// verified at build time -- no dynamic user input.
export default function CommodityArt({
  id,
  className,
  ariaLabel,
}: {
  id: string;
  className?: string;
  ariaLabel?: string;
}) {
  const entry = (art as Record<string, { description: string; svg: string }>)[id];
  if (!entry) return null;
  return (
    <div
      className={"commodity-art " + (className ?? "")}
      role="img"
      aria-label={ariaLabel ?? entry.description}
      dangerouslySetInnerHTML={{ __html: entry.svg }}
    />
  );
}

export function hasIllustration(id: string): boolean {
  return !!(art as Record<string, unknown>)[id];
}
