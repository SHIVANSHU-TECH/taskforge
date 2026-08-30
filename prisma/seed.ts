import "dotenv/config";
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/password";
import { seedRecipes } from "../src/server/recipes/seed";

async function main(): Promise<void> {
  const orgName = process.env.SEED_ORG_NAME || "TaskForge";
  const email = (process.env.SEED_OWNER_EMAIL || "owner@taskforge.local").toLowerCase();
  const password = process.env.SEED_OWNER_PASSWORD || "changeme123";

  const org = await prisma.organization.upsert({
    where: { id: "seed-org" },
    update: { name: orgName },
    create: { id: "seed-org", name: orgName },
  });

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.upsert({
    where: { email },
    update: { role: "owner", organizationId: org.id },
    create: { email, name: "Owner", passwordHash, role: "owner", organizationId: org.id },
  });

  const workspaceCount = await prisma.workspace.count({ where: { organizationId: org.id } });
  if (workspaceCount === 0) {
    await prisma.workspace.create({ data: { name: "Default", organizationId: org.id } });
  }

  console.log(`✓ Seeded org "${org.name}" and owner ${user.email}`);
  console.log(`  Sign in with: ${email} / ${password}`);

  const recipes = await seedRecipes(org.id);
  if (recipes.created.length > 0) {
    console.log(`✓ Seeded ${recipes.created.length} recipe(s): ${recipes.created.join(", ")}`);
  }
  if (recipes.skipped.length > 0) {
    console.log(`  Skipped ${recipes.skipped.length} existing recipe(s): ${recipes.skipped.join(", ")}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
