"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { updateUsername } from "@/lib/users";
import { cleanText } from "@/lib/validate";

export async function saveProfileAction(
  username: string,
): Promise<{ ok: boolean; message?: string; error?: string }> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: "Not signed in." };

  await updateUsername(email, cleanText(username, 40) || null);
  for (const p of ["/", "/add", "/log", "/summary", "/settlement", "/profile"])
    revalidatePath(p);
  return { ok: true, message: "Profile updated successfully!" };
}
