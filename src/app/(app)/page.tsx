import { redirect } from "next/navigation";
import { homePathFor } from "@/lib/auth/roles";
import { requireUser } from "@/lib/dal";

export default async function Home() {
  const user = await requireUser();
  redirect(homePathFor(user.role));
}
