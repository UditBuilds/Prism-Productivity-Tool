import { redirect } from "next/navigation";

// Root entry — middleware sends unauthenticated users to /login,
// authenticated users land on the dashboard.
export default function Home() {
  redirect("/dashboard");
}
