"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { updateName } from "@/lib/users";
import { cleanText } from "@/lib/validate";

export async function saveProfileAction(
  firstName: string,
  lastName: string,
): Promise<{ ok: boolean; message?: string; error?: string }> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: "Not signed in." };

  const first = cleanText(firstName, 40);
  if (!first) return { ok: false, error: "Please enter a first name." };
  await updateName(email, first, cleanText(lastName, 40) || null);
  revalidatePath("/", "layout");
  return { ok: true, message: "Profile updated successfully!" };
}
