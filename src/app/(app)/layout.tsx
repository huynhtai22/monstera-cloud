import { Suspense } from "react";
import { WorkspaceStartup } from "@/components/WorkspaceStartup";
import { workspaceStartupScript } from "@/components/workspace-startup-script";
import { WorkspaceShellSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { AppLayout } from "@/components/AppLayout";

export default function AppLayoutGroup({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <>
            <script dangerouslySetInnerHTML={{ __html: workspaceStartupScript }} />
            <WorkspaceStartup>
                <Suspense fallback={<WorkspaceShellSkeleton />}>
                    <AppLayout>{children}</AppLayout>
                </Suspense>
            </WorkspaceStartup>
        </>
    );
}
