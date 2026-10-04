import type { Metadata } from "next";

import { DecideExperience } from "@/components/DecideExperience";

export const metadata: Metadata = {
  title: "Help me decide — Playermaker",
};

export default function HelpMeDecidePage() {
  return <DecideExperience />;
}
