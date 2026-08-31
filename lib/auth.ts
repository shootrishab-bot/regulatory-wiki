import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { Role } from "@/app/generated/prisma/enums";
import { prisma } from "./prisma";

/**
 * NextAuth v4 config for gating /admin/review behind an ADMIN session.
 *
 * PROVIDER CHOICE: Credentials (email + password), not OAuth or Email
 * magic-link -- confirmed with the project owner rather than assumed, since
 * .env had no OAuth client id/secret or SMTP config to build against, and
 * inventing either would mean fabricating values. Credentials needs neither.
 *
 * SESSION STRATEGY: JWT, not database. NextAuth v4 only ever calls an
 * Adapter for OAuth/Email sign-ins -- Credentials-based sign-ins are
 * explicitly never persisted through one (see NextAuth's own Credentials
 * provider docs), so there is nothing for a Prisma Adapter to do here even
 * if one were configured. This is also why prisma/schema.prisma's User model
 * did NOT need the Account/Session/VerificationToken tables its old comment
 * anticipated -- those exist to support the adapter path this setup doesn't
 * use.
 *
 * role and id are threaded through the `jwt` -> `session` callback chain so
 * every session carries the User's real Role from Postgres, not just an
 * email -- see types/next-auth.d.ts for the module augmentation that makes
 * `session.user.role` and `token.role` type-safe elsewhere.
 */
export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email.trim().toLowerCase() },
        });
        if (!user) return null;

        const valid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!valid) return null;

        return { id: user.id, email: user.email, name: user.name, role: user.role };
      },
    }),
  ],
  session: {
    strategy: "jwt",
    // Short enough that a stolen/forgotten-open session on this internal
    // admin tool doesn't stay valid indefinitely; long enough not to be
    // annoying for someone actively working the review queue.
    maxAge: 8 * 60 * 60,
  },
  pages: {
    signIn: "/admin/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      // `user` is only present on the initial sign-in call -- persist its
      // role/id onto the token so every subsequent request's token carries
      // them without re-querying Postgres per-request.
      if (user) {
        token.id = user.id;
        token.role = (user as { role: Role }).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
      }
      return session;
    },
  },
};
