import { Db } from "../Database/Db";
import { Companies, Customers, Products, Sessions, Users } from "../Database/Schema";
import { HashPassword, NewToken } from "../Modules/Auth/Auth.Service";

let Counter = 0;

export async function SeedCompany(Name = `Company ${++Counter}`) {
  const [Company] = await Db.insert(Companies).values({ Name }).returning();
  const Owner = await SeedUser(Company.Id, { Role: "Owner" });
  return { Company, Owner: Owner.User, Token: Owner.Token, Password: Owner.Password };
}

export async function SeedUser(CompanyId: number, Overrides: { Role?: string; Email?: string; Password?: string } = {}) {
  const Password = Overrides.Password ?? "Password123!";
  const [User] = await Db.insert(Users)
    .values({
      CompanyId,
      Email: Overrides.Email ?? `user${++Counter}.${Date.now()}@example.com`,
      Name: `User ${Counter}`,
      Role: Overrides.Role ?? "Staff",
      PasswordHash: await HashPassword(Password),
    })
    .returning();
  const Token = NewToken();
  await Db.insert(Sessions).values({ Token, UserId: User.Id, ExpiresAt: new Date(Date.now() + 86400_000) });
  return { User, Token, Password };
}

export async function SeedCustomer(CompanyId: number, Overrides: Partial<typeof Customers.$inferInsert> = {}) {
  const [Customer] = await Db.insert(Customers)
    .values({ CompanyId, Name: `Customer ${++Counter}`, ...Overrides })
    .returning();
  return Customer;
}

export async function SeedProduct(CompanyId: number, Overrides: Partial<typeof Products.$inferInsert> = {}) {
  const [Product] = await Db.insert(Products)
    .values({ CompanyId, Name: `Product ${++Counter}`, Sku: `SKU-${Counter}`, Price: "100.00", Stock: 100, ...Overrides })
    .returning();
  return Product;
}
