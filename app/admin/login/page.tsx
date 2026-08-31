import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { LoginForm } from "@/components/login-form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

type SearchParams = Promise<{ from?: string }>;

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { from } = await searchParams;
  // Real server-side redirect for someone hitting the URL directly while
  // already signed in as ADMIN -- not just a UI nicety.
  const session = await getServerSession(authOptions);
  if (session?.user?.role === "ADMIN") {
    redirect(from && from.startsWith("/admin") ? from : "/admin/review");
  }

  const callbackUrl = from && from.startsWith("/admin") ? from : "/admin/review";

  return (
    <div className="mx-auto max-w-sm py-16">
      <Card>
        <CardHeader>
          <CardTitle>Admin sign in</CardTitle>
          <CardDescription>Access to the review queue is restricted to admins.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm callbackUrl={callbackUrl} />
        </CardContent>
      </Card>
    </div>
  );
}
