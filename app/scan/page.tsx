import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentSession, getT } from "@/lib/current";
import { PageHeader } from "@/components/page-header";
import { ScanFlow } from "@/components/scan/scan-flow";

export default async function ScanPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/onboarding");
  const t = await getT();

  // Family members can follow the schedule but not change medicines -- the
  // same rule the medicines_write policy enforces in the database.
  if (session.role !== "patient") {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title={t.scan.title} />
        <p className="rounded-2xl border-2 border-line bg-surface-muted px-5 py-6 text-lg">
          {t.scan.caregiverOnly}
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

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t.scan.title} subtitle={t.scan.subtitle} />
      <ScanFlow />
    </div>
  );
}
