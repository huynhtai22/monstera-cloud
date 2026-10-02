import { Suspense } from "react";
import { AppLayout } from "@/components/AppLayout";

export default function AppLayoutGroup({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <Suspense fallback={null}>
            <AppLayout>{children}</AppLayout>
        </Suspense>
    );
}
