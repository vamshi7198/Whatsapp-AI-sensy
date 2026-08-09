import { requireAuth } from "@/lib/auth/guards";

import { ComingSoon } from "../_components/coming-soon";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  await requireAuth("report:view");

  return (
    <ComingSoon
      title="Reports"
      phase="Phase 1d"
      description="How your campaigns performed, across any date range."
      willDo={[
        "Delivery, read and failure rates for every campaign",
        "Reply rates, so you can see what customers actually responded to",
        "Estimated and actual messaging cost",
        "Export any report as CSV",
      ]}
      blockedBy="Campaign sending and delivery tracking."
    />
  );
}
