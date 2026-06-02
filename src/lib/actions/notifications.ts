"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { markAllRead, markRead } from "@/lib/notifications";

export async function markAllReadAction(): Promise<{ ok: boolean }> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false };
  await markAllRead(email);
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function markReadAction(id: number): Promise<{ ok: boolean }> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false };
  await markRead(email, id);
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
  return { ok: true };
}
