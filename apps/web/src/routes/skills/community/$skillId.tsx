import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { lazy, Suspense, type ReactNode } from "react";
import { COMMUNITY_SKILL_METADATA } from "@/lib/community-skill-metadata";

const CommunitySkillPage = lazy(() =>
  import("./-community-skill-page").then((module) => ({
    default: module.CommunitySkillPage,
  })),
);
const communitySkillLoadingFallback = <CommunitySkillLoading />;

/**
 * /skills/community/$skillId — community skill detail (was
 * src/app/skills/community/[skillId]/page.tsx).
 *
 * Protected by the parent /skills layout `beforeLoad` guard.
 *
 * Catalog data is a static client-importable constant, so dynamic head metadata is computed
 * synchronously in `head` from the route params (no loader / server work required). The page
 * keeps its user-facing not-found behavior via a route-specific notFoundComponent.
 */
export const Route = createFileRoute("/skills/community/$skillId")({
  head: ({ params }) => {
    const skill = COMMUNITY_SKILL_METADATA[params.skillId];
    if (!skill) {
      return { meta: [{ title: "Skill not found | CmdClaw" }] };
    }
    return {
      meta: [
        { title: `${skill.title} | CmdClaw` },
        { name: "description", content: skill.description },
      ],
    };
  },
  notFoundComponent: CommunitySkillNotFound,
  component: CommunitySkillRoute,
});

function CommunitySkillNotFound() {
  return (
    <CommunitySkillPageFrame>
      <p className="text-muted-foreground text-sm">Skill not found.</p>
    </CommunitySkillPageFrame>
  );
}

function CommunitySkillRoute() {
  const { skillId } = Route.useParams();

  return (
    <Suspense fallback={communitySkillLoadingFallback}>
      <CommunitySkillPage skillId={skillId} />
    </Suspense>
  );
}

function CommunitySkillLoading() {
  return (
    <CommunitySkillPageFrame>
      <div className="space-y-4" aria-busy="true" aria-label="Loading skill details">
        <div className="bg-muted h-6 w-40 rounded" />
        <div className="bg-muted h-4 w-full max-w-xl rounded" />
        <div className="bg-muted h-4 w-2/3 rounded" />
      </div>
    </CommunitySkillPageFrame>
  );
}

function CommunitySkillPageFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl pb-8">
      <Link
        to="/toolbox"
        className="text-muted-foreground hover:text-foreground mb-8 inline-flex items-center gap-1.5 text-xs transition-colors"
      >
        <ArrowLeft className="size-3" />
        Back to Toolbox
      </Link>
      {children}
    </div>
  );
}
