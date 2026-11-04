import { inline } from "./brief";

/** Inline markdown (code spans, emphasis) rendered into a tag — the shared
 *  one-line renderer the Brief cards and the Library rows use. */
export function Html({
  as: Tag = "span",
  md,
  className,
}: {
  as?: "span" | "p" | "h2" | "pre";
  md: string;
  className?: string;
}) {
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: inline(md) }} />;
}
