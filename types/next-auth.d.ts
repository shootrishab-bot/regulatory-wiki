import type { DefaultSession } from "next-auth";
import type { Role } from "@/app/generated/prisma/enums";

/**
 * Module augmentation, not a new type system -- adds `id`/`role` to
 * NextAuth's own Session/User/JWT shapes so lib/auth.ts's callbacks and
 * every `getServerSession()`/`getToken()` call site get real type-checking
 * on the two fields this app actually reads, instead of `any`.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    role: Role;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
  }
}
