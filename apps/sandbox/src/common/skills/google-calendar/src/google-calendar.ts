export { calculateAvailabilitySlots, filterSearchEvents, main } from "./google-calendar-lib";
import { main } from "./google-calendar-lib";
import { enforceWorkspaceIntegrationPolicyForCli } from "../../../lib/integration-policy-gate";

enforceWorkspaceIntegrationPolicyForCli("google-calendar")
  .then(main)
  .catch((error) => {
    console.error("Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
