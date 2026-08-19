import { PrismaClient } from "@prisma/client";
import { assertTenantScoped, shouldSkipTenantGuard } from "@/lib/tenant-guard";

const prismaClientSingleton = () => new PrismaClient();

declare global {
  var prismaBaseGlobal: undefined | PrismaClient;
  var prismaGlobal: undefined | ReturnType<typeof createGuardedPrisma>;
}

function createGuardedPrisma(base: PrismaClient) {
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!shouldSkipTenantGuard()) {
            assertTenantScoped(model, operation, args);
          }
          return query(args);
        },
      },
    },
  });
}

const prismaBase = globalThis.prismaBaseGlobal ?? prismaClientSingleton();
const prisma = globalThis.prismaGlobal ?? createGuardedPrisma(prismaBase);

/** Unguarded client for NextAuth adapter and other identity tables. */
export { prismaBase };

export default prisma;

if (process.env.NODE_ENV !== "production") {
  globalThis.prismaBaseGlobal = prismaBase;
  globalThis.prismaGlobal = prisma;
}
