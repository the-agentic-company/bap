import { CoworkerOverviewDashboard } from "@/components/coworker-overview-dashboard";
import { useCoworkerOverview } from "@/orpc/hooks/coworkers";

type CoworkerOverviewPageProps = {
  coworkerLinkPrefix?: string;
};

export default function CoworkerOverviewPage({
  coworkerLinkPrefix = "/agents/edit/",
}: CoworkerOverviewPageProps) {
  const { data, isLoading } = useCoworkerOverview();

  return (
    <div className="space-y-8">
      <CoworkerOverviewDashboard
        data={data}
        isLoading={isLoading}
        coworkerLinkPrefix={coworkerLinkPrefix}
      />
    </div>
  );
}
