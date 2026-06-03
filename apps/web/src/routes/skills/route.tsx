import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireSession } from "@/lib/route-guards";

/**
 * Skills shell layout (was src/app/skills/layout.tsx).
 *
 * Protected access (access=protected) lives in `beforeLoad`: an unauthenticated request is
 * redirected to /login (or worktree auto-login) with a callbackUrl back to the originally
 * requested path, so the user returns to the skill they were viewing after sign-in.
 *
 * Covers the nested skill-management and community-catalog pages:
 *   /skills/$id                    — user skill editor
 *   /skills/community/$skillId     — community skill detail
 */
export const Route = createFileRoute("/skills")({
  beforeLoad: ({ location }) => requireSession(location.href),
  component: SkillsLayout,
});

function SkillsLayout() {
  return (
    <div className="bg-background min-h-screen">
      <main className="mx-auto w-full max-w-[1400px] px-4 pt-4 pb-16 sm:px-8 sm:pt-10">
        <Outlet />
      </main>
    </div>
  );
}
