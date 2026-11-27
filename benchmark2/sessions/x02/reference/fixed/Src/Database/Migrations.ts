import type { PGlite } from "@electric-sql/pglite";

export type Migration = { Id: string; Up: (Client: PGlite) => Promise<void> };

export const Migrations: Migration[] = [
  {
    Id: "0001_Init",
    Up: async (Client) => {
      await Client.exec(`
        CREATE TABLE "Companies" (
          "Id" serial PRIMARY KEY,
          "Name" text NOT NULL,
          "CreatedAt" timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE "Users" (
          "Id" serial PRIMARY KEY,
          "CompanyId" integer NOT NULL REFERENCES "Companies"("Id"),
          "Email" text NOT NULL,
          "Name" text NOT NULL,
          "PasswordHash" text NOT NULL,
          "Role" text NOT NULL DEFAULT 'Staff',
          "IsActive" boolean NOT NULL DEFAULT true,
          "CreatedAt" timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX "Users_Email_Unique" ON "Users"("Email");
        CREATE TABLE "Sessions" (
          "Id" serial PRIMARY KEY,
          "Token" text NOT NULL UNIQUE,
          "UserId" integer NOT NULL REFERENCES "Users"("Id"),
          "CreatedAt" timestamptz NOT NULL DEFAULT now(),
          "ExpiresAt" timestamptz NOT NULL
        );
        CREATE TABLE "Customers" (
          "Id" serial PRIMARY KEY,
          "CompanyId" integer NOT NULL REFERENCES "Companies"("Id"),
          "Name" text NOT NULL,
          "Phone" text,
          "Email" text,
          "WalletBalance" numeric(12,2) NOT NULL DEFAULT 0,
          "CreatedAt" timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX "Customers_CompanyId_Idx" ON "Customers"("CompanyId");
        CREATE TABLE "Products" (
          "Id" serial PRIMARY KEY,
          "CompanyId" integer NOT NULL REFERENCES "Companies"("Id"),
          "Name" text NOT NULL,
          "Sku" text NOT NULL,
          "Price" numeric(12,2) NOT NULL,
          "Stock" integer NOT NULL DEFAULT 0,
          "IsActive" boolean NOT NULL DEFAULT true,
          "CreatedAt" timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX "Products_CompanySku_Unique" ON "Products"("CompanyId", "Sku");
        CREATE TABLE "Suppliers" (
          "Id" serial PRIMARY KEY,
          "CompanyId" integer NOT NULL REFERENCES "Companies"("Id"),
          "Name" text NOT NULL,
          "Phone" text,
          "CreatedAt" timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE "PurchaseOrders" (
          "Id" serial PRIMARY KEY,
          "CompanyId" integer NOT NULL REFERENCES "Companies"("Id"),
          "SupplierId" integer NOT NULL REFERENCES "Suppliers"("Id"),
          "Status" text NOT NULL DEFAULT 'Draft',
          "Total" numeric(12,2) NOT NULL,
          "CreatedAt" timestamptz NOT NULL DEFAULT now(),
          "ReceivedAt" timestamptz
        );
        CREATE TABLE "PurchaseOrderItems" (
          "Id" serial PRIMARY KEY,
          "PurchaseOrderId" integer NOT NULL REFERENCES "PurchaseOrders"("Id"),
          "ProductId" integer NOT NULL REFERENCES "Products"("Id"),
          "Quantity" integer NOT NULL,
          "UnitCost" numeric(12,2) NOT NULL,
          "LineTotal" numeric(12,2) NOT NULL
        );
        CREATE TABLE "StockMovements" (
          "Id" serial PRIMARY KEY,
          "CompanyId" integer NOT NULL REFERENCES "Companies"("Id"),
          "ProductId" integer NOT NULL REFERENCES "Products"("Id"),
          "Change" integer NOT NULL,
          "Reason" text NOT NULL,
          "RefId" integer,
          "CreatedAt" timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE "Expenses" (
          "Id" serial PRIMARY KEY,
          "CompanyId" integer NOT NULL REFERENCES "Companies"("Id"),
          "Category" text NOT NULL,
          "Amount" numeric(12,2) NOT NULL,
          "SpentOn" date NOT NULL,
          "Note" text,
          "CreatedAt" timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE "AuditLogs" (
          "Id" serial PRIMARY KEY,
          "CompanyId" integer NOT NULL REFERENCES "Companies"("Id"),
          "UserId" integer,
          "Action" text NOT NULL,
          "Entity" text NOT NULL,
          "EntityId" integer,
          "CreatedAt" timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE "Orders" (
          "Id" serial PRIMARY KEY,
          "CompanyId" integer NOT NULL REFERENCES "Companies"("Id"),
          "CustomerId" integer NOT NULL REFERENCES "Customers"("Id"),
          "Status" text NOT NULL DEFAULT 'Pending',
          "Subtotal" numeric(12,2) NOT NULL,
          "Discount" numeric(12,2) NOT NULL DEFAULT 0,
          "Tax" numeric(12,2) NOT NULL,
          "Total" numeric(12,2) NOT NULL,
          "CreatedAt" timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX "Orders_CompanyId_Idx" ON "Orders"("CompanyId");
        CREATE TABLE "OrderItems" (
          "Id" serial PRIMARY KEY,
          "OrderId" integer NOT NULL REFERENCES "Orders"("Id"),
          "ProductId" integer NOT NULL REFERENCES "Products"("Id"),
          "Quantity" integer NOT NULL,
          "UnitPrice" numeric(12,2) NOT NULL,
          "LineTotal" numeric(12,2) NOT NULL
        );
        CREATE TABLE "Payments" (
          "Id" serial PRIMARY KEY,
          "CompanyId" integer NOT NULL REFERENCES "Companies"("Id"),
          "OrderId" integer NOT NULL REFERENCES "Orders"("Id"),
          "Amount" numeric(12,2) NOT NULL,
          "Method" text NOT NULL,
          "Status" text NOT NULL DEFAULT 'Completed',
          "ProviderRef" text,
          "CreatedAt" timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE "SystemSettings" (
          "Key" text PRIMARY KEY,
          "Value" jsonb NOT NULL,
          "UpdatedAt" timestamptz NOT NULL DEFAULT now()
        );
      `);
    },
  },
  {
    Id: "0002_PriceLists",
    Up: async (Client) => {
      await Client.exec(`
        CREATE TABLE "PriceLists" (
          "Id" serial PRIMARY KEY,
          "CompanyId" integer NOT NULL REFERENCES "Companies"("Id"),
          "CustomerId" integer NOT NULL REFERENCES "Customers"("Id"),
          "ValidFrom" date NOT NULL,
          "ValidTo" date,
          "CreatedAt" timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX "PriceLists_Customer_Idx" ON "PriceLists"("CustomerId");
        CREATE TABLE "PriceListItems" (
          "Id" serial PRIMARY KEY,
          "PriceListId" integer NOT NULL REFERENCES "PriceLists"("Id"),
          "ProductId" integer NOT NULL REFERENCES "Products"("Id"),
          "Price" numeric(12,2) NOT NULL CHECK ("Price" > 0)
        );
        CREATE UNIQUE INDEX "PriceListItems_Unique" ON "PriceListItems"("PriceListId", "ProductId");
      `);
    },
  },
  {
    Id: "0003_Quotes",
    Up: async (Client) => {
      await Client.exec(`
        CREATE TABLE "Quotes" (
          "Id" serial PRIMARY KEY,
          "CompanyId" integer NOT NULL REFERENCES "Companies"("Id"),
          "CustomerId" integer NOT NULL REFERENCES "Customers"("Id"),
          "SalespersonId" integer NOT NULL REFERENCES "Users"("Id"),
          "Status" text NOT NULL DEFAULT 'Draft',
          "Version" integer NOT NULL DEFAULT 1,
          "ApprovedBy" integer REFERENCES "Users"("Id"),
          "ApprovedAt" timestamptz,
          "OrderId" integer REFERENCES "Orders"("Id"),
          "CreatedAt" timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX "Quotes_CompanyId_Idx" ON "Quotes"("CompanyId");
        CREATE TABLE "QuoteVersions" (
          "Id" serial PRIMARY KEY,
          "QuoteId" integer NOT NULL REFERENCES "Quotes"("Id"),
          "Version" integer NOT NULL,
          "Subtotal" numeric(12,2) NOT NULL,
          "Tax" numeric(12,2) NOT NULL,
          "Total" numeric(12,2) NOT NULL,
          "CreatedAt" timestamptz NOT NULL
        );
        CREATE UNIQUE INDEX "QuoteVersions_Unique" ON "QuoteVersions"("QuoteId", "Version");
        CREATE TABLE "QuoteLines" (
          "Id" serial PRIMARY KEY,
          "QuoteVersionId" integer NOT NULL REFERENCES "QuoteVersions"("Id"),
          "ProductId" integer NOT NULL REFERENCES "Products"("Id"),
          "Quantity" integer NOT NULL CHECK ("Quantity" > 0),
          "DiscountPercent" numeric(5,2) NOT NULL DEFAULT 0,
          "UnitPrice" numeric(12,2) NOT NULL,
          "LineTotal" numeric(12,2) NOT NULL
        );
        CREATE INDEX "QuoteLines_Version_Idx" ON "QuoteLines"("QuoteVersionId");
      `);
    },
  },
  {
    Id: "0004_QuoteValidity",
    Up: async (Client) => {
      await Client.exec(`
        ALTER TABLE "Quotes" ADD COLUMN "ValidUntil" date;
        UPDATE "Quotes" Q SET "ValidUntil" = (V."CreatedAt" AT TIME ZONE 'UTC')::date + 14
          FROM "QuoteVersions" V WHERE V."QuoteId" = Q."Id" AND V."Version" = Q."Version";
        UPDATE "Quotes" SET "ValidUntil" = ("CreatedAt" AT TIME ZONE 'UTC')::date + 14 WHERE "ValidUntil" IS NULL;
        ALTER TABLE "Quotes" ALTER COLUMN "ValidUntil" SET NOT NULL;
        CREATE TABLE "QuoteSettings" (
          "CompanyId" integer PRIMARY KEY REFERENCES "Companies"("Id"),
          "ValidityDays" integer NOT NULL CHECK ("ValidityDays" BETWEEN 1 AND 365)
        );
      `);
    },
  },
  {
    Id: "0005_CustomerGroups",
    Up: async (Client) => {
      await Client.exec(`
        CREATE TABLE "CustomerGroups" (
          "Id" serial PRIMARY KEY,
          "CompanyId" integer NOT NULL REFERENCES "Companies"("Id"),
          "Name" text NOT NULL,
          "ApprovalThreshold" numeric(12,2) NOT NULL CHECK ("ApprovalThreshold" >= 0),
          "IsDefault" boolean NOT NULL DEFAULT false,
          "CreatedAt" timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX "CustomerGroups_CompanyId_Idx" ON "CustomerGroups"("CompanyId");
        CREATE UNIQUE INDEX "CustomerGroups_Default_Unique" ON "CustomerGroups"("CompanyId") WHERE "IsDefault";
        ALTER TABLE "Customers" ADD COLUMN "GroupId" integer REFERENCES "CustomerGroups"("Id");
        INSERT INTO "CustomerGroups" ("CompanyId", "Name", "ApprovalThreshold", "IsDefault")
          SELECT "Id", 'عادي', 50000, true FROM "Companies";
        UPDATE "Customers" C SET "GroupId" = G."Id" FROM "CustomerGroups" G WHERE G."CompanyId" = C."CompanyId" AND G."IsDefault";
      `);
    },
  },
];

export async function Migrate(Client: PGlite, Options: { UpTo?: string } = {}) {
  await Client.exec(`CREATE TABLE IF NOT EXISTS "SchemaMigrations" ("Id" text PRIMARY KEY, "AppliedAt" timestamptz NOT NULL DEFAULT now())`);
  const Applied = await Client.query<{ Id: string }>(`SELECT "Id" FROM "SchemaMigrations"`);
  const Done = new Set(Applied.rows.map((R) => R.Id));
  for (const M of Migrations) {
    if (!Done.has(M.Id)) {
      await M.Up(Client);
      await Client.query(`INSERT INTO "SchemaMigrations" ("Id") VALUES ($1)`, [M.Id]);
    }
    if (Options.UpTo && M.Id === Options.UpTo) break;
  }
}
