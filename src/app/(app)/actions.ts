"use server";

import { redirect } from "next/navigation";

import { destroySession, getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export async function logout() {
  const user = await getCurrentUser();

  if (user) {
    await prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        actorEmail: user.email,
        action: "auth.logout",
      },
    });
  }

  await destroySession();
  redirect("/login");
}
