export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="dark flex min-h-screen items-center justify-center bg-canvas px-4 font-sans text-ink sm:px-6 lg:px-8">
      <div className="max-w-md w-full">
        {children}
      </div>
    </div>
  );
}
