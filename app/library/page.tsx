import type { Metadata } from "next";
import { LibraryWorkspace } from "@/components/LibraryWorkspace";

export const metadata: Metadata = {
  title: "Report library",
};

export default function LibraryPage() {
  return <LibraryWorkspace />;
}
