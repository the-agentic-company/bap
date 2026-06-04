import { Link, notFound } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { CommunitySkillDetailContent } from "@/components/community-skill-detail-content";
import { COMMUNITY_SKILLS_DATA } from "@/lib/community-skills";

export function CommunitySkillPage({ skillId }: { skillId: string }) {
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
