import { ArrowLeft } from "lucide-react";
import { AppLink as Link } from "../-lib/app-link";
import { CoworkerOverviewDashboard } from "@/components/coworker-overview-dashboard";
import { useCoworkerOverview } from "@/orpc/hooks/coworkers";

export default function CoworkerOverviewPage() {
  const { data, isLoading } = useCoworkerOverview();

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <Link
          href="/agents"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-5" />
        </Link>
      </div>
      <CoworkerOverviewDashboard
        data={data}
        isLoading={isLoading}
        coworkerLinkPrefix="/agents/edit/"
      />
    </div>
  );
}
