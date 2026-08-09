import { requireAuth } from "@/lib/auth/guards";
import { isMetaConnected } from "@/lib/settings";
import { getProvider } from "@/lib/whatsapp";

import { BusinessProfileForm } from "./_form";

export const metadata = { title: "Business profile" };

export default async function BusinessProfilePage() {
  await requireAuth("settings:business");

  const connected = await isMetaConnected();

  if (!connected) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950">
        <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
          WhatsApp is not connected
        </p>
        <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
          Connect your WhatsApp Business account before editing the profile
          customers see.
        </p>
      </div>
    );
  }

  const provider = await getProvider();

  // Read from Meta rather than a local copy: the profile can be changed in
  // WhatsApp Manager too, and showing a stale local version would invite
  // someone to overwrite a change they never saw.
  const [profile, phone] = await Promise.all([
    provider?.getBusinessProfile() ?? null,
    provider?.getPhoneNumber() ?? null,
  ]);

  return (
    <BusinessProfileForm
      initial={{
        about: profile?.about ?? "",
        description: profile?.description ?? "",
        address: profile?.address ?? "",
        email: profile?.email ?? "",
        vertical: profile?.vertical ?? "",
        website1: profile?.websites?.[0] ?? "",
        website2: profile?.websites?.[1] ?? "",
        profilePictureUrl: profile?.profilePictureUrl ?? null,
        displayName: phone?.verifiedName ?? "",
        phoneNumber: phone?.displayPhoneNumber ?? "",
      }}
    />
  );
}
