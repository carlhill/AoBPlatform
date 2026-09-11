import { redirect } from 'next/navigation';

/**
 * The patient's page lives under /patient, like every audience's pages live
 * under their prefix (/practice, /practitioner, /platform). This path was the
 * first home of the approval page and is kept ONLY as a redirect: a link
 * already sitting in somebody's inbox must never stop working because we
 * tidied a URL. Nothing else should link here.
 */
export default async function LegacyAgreePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  redirect(`/patient/agree/${token}`);
}
