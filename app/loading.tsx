import { getLanguageFast } from "@/lib/current";
import { getDictionary } from "@/lib/i18n";
import { LoadingScreen } from "@/components/skeleton";

// Shown instantly while any screen loads. Language comes from the cookie,
// never the database, so this can render before the page's data arrives.
export default async function Loading() {
  const t = getDictionary(await getLanguageFast());
  return <LoadingScreen label={t.common.loading} variant="dashboard" />;
}
