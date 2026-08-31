import type { Metadata } from "next";
import { AnalyzeWorkspace } from "@/components/AnalyzeWorkspace";

export const metadata: Metadata = {
  title: "Analyze reports",
};

export default function AnalyzePage() {
  return <AnalyzeWorkspace />;
}
