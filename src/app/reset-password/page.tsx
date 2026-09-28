import AuthShell from "@/components/AuthShell";
import ResetPasswordForm from "@/components/ResetPasswordForm";

export const metadata = { title: "Choose a new password — Second" };
export const dynamic = "force-dynamic";

export default function ResetPasswordPage({ searchParams }: { searchParams: { token?: string } }) {
  return (
    <AuthShell>
      <ResetPasswordForm token={searchParams.token ?? ""} />
    </AuthShell>
  );
}
