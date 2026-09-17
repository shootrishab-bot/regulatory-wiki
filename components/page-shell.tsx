import Link from "next/link";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Breadcrumb trail. Every page below the top level renders one, because the
 * site is now a hierarchy (hub -> facet index -> tag -> documents) rather
 * than a single filtered list, and without a trail it is easy to lose track
 * of which regulator's vocabulary you are currently inside.
 */
export function Crumbs({ items }: { items: Crumb[] }) {
  return (
    <Breadcrumb className="mb-4">
      <BreadcrumbList className="text-sm">
        <BreadcrumbItem>
          {/* base-ui polymorphism uses `render`, not shadcn's older `asChild`. */}
          {/* The trail starts at the library hub, not at "/": "/" is now the
              gyaani dashboard, a level above this part of the product. */}
          <BreadcrumbLink render={<Link href="/library" />}>Regulatory library</BreadcrumbLink>
        </BreadcrumbItem>
        {items.map((c, i) => (
          <span key={`${c.label}-${i}`} className="contents">
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              {c.href && i < items.length - 1 ? (
                <BreadcrumbLink render={<Link href={c.href} />}>{c.label}</BreadcrumbLink>
              ) : (
                <BreadcrumbPage>{c.label}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </span>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

export function PageHeader({
  title,
  description,
  meta,
}: {
  title: string;
  description?: React.ReactNode;
  meta?: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
      {description && (
        <p className="mt-2 max-w-3xl text-base text-muted-foreground">{description}</p>
      )}
      {meta && <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div>}
    </div>
  );
}
