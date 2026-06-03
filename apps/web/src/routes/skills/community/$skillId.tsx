import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import {
  CommunitySkillDetailContent,
  COMMUNITY_SKILLS_DATA,
} from "@/components/community-skill-detail-content";

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
    const skill = COMMUNITY_SKILLS_DATA[params.skillId];
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
  component: CommunitySkillPage,
});

function CommunitySkillNotFound() {
  return (
    <div className="mx-auto max-w-3xl pb-8">
      <Link
        to="/toolbox"
        className="text-muted-foreground hover:text-foreground mb-8 inline-flex items-center gap-1.5 text-xs transition-colors"
      >
        <ArrowLeft className="size-3" />
        Back to Toolbox
      </Link>
      <p className="text-muted-foreground text-sm">Skill not found.</p>
    </div>
  );
}

function CommunitySkillPage() {
  const { skillId } = Route.useParams();
  const skill = COMMUNITY_SKILLS_DATA[skillId];

  if (!skill) {
    throw notFound();
  }

  return (
    <div className="mx-auto max-w-3xl pb-8">
      <Link
        to="/toolbox"
        className="text-muted-foreground hover:text-foreground mb-8 inline-flex items-center gap-1.5 text-xs transition-colors"
      >
        <ArrowLeft className="size-3" />
        Back to Toolbox
      </Link>

      <CommunitySkillDetailContent skill={skill} />
    </div>
  );
}
