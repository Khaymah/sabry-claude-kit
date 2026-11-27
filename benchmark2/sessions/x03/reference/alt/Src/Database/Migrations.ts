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
    Id: "0002_Organizers_Events",
    Up: async (Client) => {
      await Client.exec(`
        CREATE TABLE "Organizers" ("Id" serial PRIMARY KEY, "CompanyId" integer NOT NULL REFERENCES "Companies"("Id"), "Name" text NOT NULL);
        CREATE TABLE "StaffAssignments" (
          "Id" serial PRIMARY KEY,
          "OrganizerId" integer NOT NULL REFERENCES "Organizers"("Id"),
          "UserId" integer NOT NULL REFERENCES "Users"("Id")
        );
        CREATE UNIQUE INDEX "StaffAssignments_Unique" ON "StaffAssignments"("OrganizerId", "UserId");
        CREATE TABLE "Events" (
          "Id" serial PRIMARY KEY,
          "CompanyId" integer NOT NULL REFERENCES "Companies"("Id"),
          "OrganizerId" integer NOT NULL REFERENCES "Organizers"("Id"),
          "Name" text NOT NULL,
          "Status" text NOT NULL,
          "Promos" jsonb NOT NULL DEFAULT '{}'::jsonb,
          "CreatedAt" timestamptz NOT NULL,
          "CancelledAt" timestamptz
        );
        CREATE TABLE "EventSessions" ("Id" serial PRIMARY KEY, "EventId" integer NOT NULL REFERENCES "Events"("Id"), "StartsAt" timestamptz NOT NULL);
        CREATE TABLE "SeatCategories" (
          "Id" serial PRIMARY KEY,
          "EventId" integer NOT NULL REFERENCES "Events"("Id"),
          "Name" text NOT NULL,
          "PricePiasters" integer NOT NULL CHECK ("PricePiasters" >= 0),
          "Capacity" integer NOT NULL CHECK ("Capacity" > 0)
        );
        CREATE TABLE "Inventory" (
          "SessionId" integer NOT NULL REFERENCES "EventSessions"("Id"),
          "CategoryId" integer NOT NULL REFERENCES "SeatCategories"("Id"),
          "Capacity" integer NOT NULL,
          "Sold" integer NOT NULL DEFAULT 0 CHECK ("Sold" >= 0 AND "Sold" <= "Capacity"),
          PRIMARY KEY ("SessionId", "CategoryId")
        );
      `);
    },
  },
  {
    Id: "0003_Holds_Tickets",
    Up: async (Client) => {
      await Client.exec(`
        CREATE TABLE "Holds" (
          "Id" serial PRIMARY KEY,
          "CompanyId" integer NOT NULL REFERENCES "Companies"("Id"),
          "EventId" integer NOT NULL REFERENCES "Events"("Id"),
          "SessionId" integer NOT NULL,
          "CategoryId" integer NOT NULL,
          "CustomerId" integer NOT NULL REFERENCES "Customers"("Id"),
          "Quantity" integer NOT NULL,
          "Status" text NOT NULL,
          "ExpiresAt" timestamptz NOT NULL
        );
        CREATE INDEX "Holds_Seat_Idx" ON "Holds"("SessionId", "CategoryId", "Status");
        CREATE TABLE "TicketOrders" (
          "Id" serial PRIMARY KEY,
          "CompanyId" integer NOT NULL REFERENCES "Companies"("Id"),
          "EventId" integer NOT NULL REFERENCES "Events"("Id"),
          "CustomerId" integer NOT NULL REFERENCES "Customers"("Id"),
          "HoldId" integer,
          "TotalPiasters" integer NOT NULL,
          "DiscountPiasters" integer NOT NULL,
          "CreatedAt" timestamptz NOT NULL
        );
        CREATE TABLE "Tickets" (
          "Id" serial PRIMARY KEY,
          "CompanyId" integer NOT NULL REFERENCES "Companies"("Id"),
          "OrderId" integer NOT NULL REFERENCES "TicketOrders"("Id"),
          "EventId" integer NOT NULL REFERENCES "Events"("Id"),
          "SessionId" integer NOT NULL,
          "CategoryId" integer NOT NULL,
          "HolderCustomerId" integer NOT NULL REFERENCES "Customers"("Id"),
          "PaidPiasters" integer NOT NULL,
          "Code" text NOT NULL UNIQUE,
          "Status" text NOT NULL,
          "CheckedInAt" timestamptz,
          "RefundPiasters" integer,
          "RefundedAt" timestamptz,
          "CreatedAt" timestamptz NOT NULL
        );
        CREATE INDEX "Tickets_Event_Idx" ON "Tickets"("EventId", "CreatedAt");
      `);
    },
  },
  {
    Id: "0004_CustomerPhoneKey",
    Up: async (Client) => {
      await Client.exec(`
        ALTER TABLE "Customers" ADD COLUMN "PhoneKey" text;
        UPDATE "Customers" SET "PhoneKey" = K FROM (
          SELECT "Id" AS CId, regexp_replace(regexp_replace("Phone", '[\\s().-]', '', 'g'), '^(\\+20|0020)', '0') AS K FROM "Customers" WHERE "Phone" IS NOT NULL
        ) X WHERE "Id" = X.CId AND X.K ~ '^01[0125][0-9]{8}$';
        CREATE INDEX "Customers_PhoneKey_Idx" ON "Customers"("CompanyId", "PhoneKey");
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
