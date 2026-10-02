import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentPatient, getCurrentSession, getT } from "@/lib/current";
import { PageHeader } from "@/components/page-header";
import { VoiceAssistant } from "@/components/voice/voice-assistant";

export default async function VoicePage() {
  const session = await getCurrentSession();
  if (!session) redirect("/onboarding");
  const t = await getT();

  if (session.role !== "patient") {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="MediMitra" />
        <p className="rounded-2xl border-2 border-line bg-surface-muted px-5 py-6 text-lg">
          {t.voice.caregiverNote}
        </p>
        <Link
          href="/"
          className="mt-4 flex min-h-touch items-center justify-center rounded-2xl bg-accent px-6 py-4 text-xl font-bold text-accent-ink"
        >
          {t.scan.goToday}
        </Link>
      </div>
    );
  }

  const patient = await getCurrentPatient();
  if (!patient) redirect("/login");

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="MediMitra" subtitle={t.voice.subtitle} />
      <VoiceAssistant firstName={patient.name.split(" ")[0]} />
    </div>
  );
}
