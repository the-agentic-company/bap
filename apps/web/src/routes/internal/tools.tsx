import { createFileRoute, Link } from "@tanstack/react-router";
import { Eye, Wrench } from "lucide-react";

/**
 * Internal tools index (`/internal/tools`).
 *
 * Internal pages now share the internal support-admin shell. This page preserves links to
 * development and debugging utilities after the support-admin surface moved to `/internal`.
 */
export const Route = createFileRoute("/internal/tools")({
  head: () => ({
    meta: [{ title: "Internal Tools · Bap" }],
  }),
  component: InternalPage,
});

const internalPages = [
  {
    title: "README Preview",
    description: "Preview the real app-backed README capture surface",
    href: "/internal/readme-preview",
    icon: Eye,
  },
  {
    title: "Component Previews",
    description: "Preview integration components with mock data",
    href: "/internal/previews",
    icon: Eye,
  },
] as const;

function InternalPage() {
  return (
    <div className="bg-background min-h-screen p-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 flex items-center gap-3">
          <Wrench className="text-muted-foreground h-8 w-8" />
          <div>
            <h1 className="text-2xl font-bold">Internal Tools</h1>
            <p className="text-muted-foreground">Development and debugging utilities</p>
          </div>
        </div>

        <div className="grid gap-4">
          {internalPages.map((page) => (
            <Link
              key={page.href}
              to={page.href}
              className="bg-card hover:bg-accent flex items-center gap-4 rounded-lg border p-4 transition-colors"
            >
              <page.icon className="text-muted-foreground h-6 w-6" />
              <div>
                <h2 className="font-medium">{page.title}</h2>
                <p className="text-muted-foreground text-sm">{page.description}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
