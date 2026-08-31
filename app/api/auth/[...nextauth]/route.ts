import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";

// NextAuth v4's own App Router support: NextAuth(authOptions) returns a
// single request handler, exported here as both GET and POST per NextAuth's
// documented app-router pattern -- this file convention (route.ts with named
// HTTP-method exports) is unchanged from what file-conventions/route.md
// describes for this Next.js version.
const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
