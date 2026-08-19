export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="dark min-h-screen bg-black text-white selection:bg-neutral-800 selection:text-white flex flex-col justify-between">
      {children}
    </div>
  );
}
