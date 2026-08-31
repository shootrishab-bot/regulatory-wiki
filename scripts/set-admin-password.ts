/**
 * Creates or updates an ADMIN user for the /admin/review Credentials login.
 * There is no public signup form by design (see prisma/schema.prisma's
 * User model comment) -- this is how an admin account actually gets
 * provisioned, run by whoever has DATABASE_URL access, not end users.
 *
 * Usage:
 *   npx tsx scripts/set-admin-password.ts <email> <password> [name]
 *
 * Safe to re-run: upserts by email, so it also works to reset an existing
 * admin's password.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { Role } from "../app/generated/prisma/enums";
import { prisma } from "../lib/prisma";

async function main() {
  const [email, password, name] = process.argv.slice(2);

  if (!email || !password) {
    console.error("Usage: npx tsx scripts/set-admin-password.ts <email> <password> [name]");
    process.exitCode = 1;
    return;
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exitCode = 1;
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const normalizedEmail = email.trim().toLowerCase();

  const user = await prisma.user.upsert({
    where: { email: normalizedEmail },
    update: { passwordHash, role: Role.ADMIN, ...(name ? { name } : {}) },
    create: { email: normalizedEmail, passwordHash, role: Role.ADMIN, name: name ?? null },
  });

  console.log(`ADMIN user ready: ${user.email} (id: ${user.id})`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => {});
  process.exitCode = 1;
});
