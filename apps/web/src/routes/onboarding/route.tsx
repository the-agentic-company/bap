import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { motion } from "motion/react";
import { AuthenticatedAppRootShell } from "@/components/authenticated-app-root-shell";
import { requireSession } from "@/lib/route-guards";
import { StepIndicator } from "./-components/step-indicator";

const STEP_MAP: Record<string, number> = {
  "/onboarding/subscriptions": 1,
  "/onboarding/integrations": 2,
};

const MOTION_INITIAL = { opacity: 0, y: 12 };
const MOTION_ANIMATE = { opacity: 1, y: 0 };
const MOTION_TRANSITION = {
  duration: 0.35,
  ease: [0.25, 0.1, 0.25, 1] as [number, number, number, number],
};

/**
 * Onboarding shell. Migrated from the previous `onboarding/layout.tsx` to a TanStack layout
 * route: child routes (`/onboarding/integrations`, `/onboarding/subscriptions`) nest under
 * this `<Outlet />`, so shell selection is route nesting rather than a global pathname
 * switch. Protected access is enforced once here via `requireSession`, covering every child
 * route; unauthenticated users are redirected to `/login` and returned to the originally
 * requested onboarding path after sign-in.
 */
export const Route = createFileRoute("/onboarding")({
  beforeLoad: async ({ location }) => ({
    sessionContext: await requireSession(location.href),
  }),
  component: OnboardingLayout,
});

function OnboardingLayout() {
  const { sessionContext } = Route.useRouteContext();
  // The step indicator still derives the active step from the current pathname, matching
  // the original layout behavior (subscriptions = 1, integrations = 2).
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const currentStep = STEP_MAP[pathname] ?? 1;

  return (
    <AuthenticatedAppRootShell initialPrincipal={sessionContext.principal}>
      <div className="bg-background flex min-h-screen flex-col px-4 pb-8">
        <div className="mx-auto w-full max-w-2xl pt-[max(1.5rem,8vh)] sm:pt-[12vh]">
          <StepIndicator current={currentStep} total={2} />
        </div>

        <div className="mx-auto w-full max-w-2xl">
          <motion.div
            key={pathname}
            initial={MOTION_INITIAL}
            animate={MOTION_ANIMATE}
            transition={MOTION_TRANSITION}
          >
            <Outlet />
          </motion.div>
        </div>
      </div>
    </AuthenticatedAppRootShell>
  );
}
