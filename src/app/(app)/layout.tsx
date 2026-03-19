import { AppLayout } from "@/components/AppLayout";

export default function AppLayoutGroup({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return <AppLayout>{children}</AppLayout>;
}
