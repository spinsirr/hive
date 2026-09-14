import type { Metadata } from "next";
import { DashboardDemo } from "./dashboard-demo";

export const metadata: Metadata = {
  title: "Hive — Dashboard UI demo",
  description:
    "Interactive dashboard preview using sample data. No account or agent execution.",
  robots: { index: false, follow: false },
};

export default function DemoPage() {
  return <DashboardDemo />;
}
