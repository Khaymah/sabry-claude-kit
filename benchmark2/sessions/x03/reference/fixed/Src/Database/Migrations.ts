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
    Id: "0002_Ticketing",
    Up: async (Client) => {
      await Client.exec(`
        CREATE TABLE "Organizers" (
          "Id" serial PRIMARY KEY,
          "CompanyId" integer NOT NULL REFERENCES "Companies"("Id"),
          "Name" text NOT NULL,
          "CreatedAt" timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX "Organizers_CompanyId_Idx" ON "Organizers"("CompanyId");
        CREATE TABLE "OrganizerStaff" (
          "OrganizerId" integer NOT NULL REFERENCES "Organizers"("Id"),
          "UserId" integer NOT NULL REFERENCES "Users"("Id"),
          PRIMARY KEY ("OrganizerId", "UserId")
        );
        CREATE TABLE "Events" (
          "Id" serial PRIMARY KEY,
          "CompanyId" integer NOT NULL REFERENCES "Companies"("Id"),
          "OrganizerId" integer NOT NULL REFERENCES "Organizers"("Id"),
          "Name" text NOT NULL,
          "Status" text NOT NULL DEFAULT 'OnSale',
          "FeePercent" integer NOT NULL,
          "FeeFixed" numeric(12,2) NOT NULL,
          "CreatedAt" timestamptz NOT NULL,
          "CancelledAt" timestamptz
        );
        CREATE INDEX "Events_Organizer_Idx" ON "Events"("CompanyId", "OrganizerId");
        CREATE TABLE "EventSessions" (
          "Id" serial PRIMARY KEY,
          "EventId" integer NOT NULL REFERENCES "Events"("Id"),
          "StartsAt" timestamptz NOT NULL
        );
        CREATE TABLE "SeatCategories" (
          "Id" serial PRIMARY KEY,
          "EventId" integer NOT NULL REFERENCES "Events"("Id"),
          "Name" text NOT NULL,
          "Price" numeric(12,2) NOT NULL CHECK ("Price" >= 0),
          "Capacity" integer NOT NULL CHECK ("Capacity" > 0)
        );
        CREATE TABLE "Promos" (
          "Id" serial PRIMARY KEY,
          "EventId" integer NOT NULL REFERENCES "Events"("Id"),
          "Code" text NOT NULL,
          "PercentOff" integer NOT NULL
        );
        CREATE UNIQUE INDEX "Promos_EventCode_Unique" ON "Promos"("EventId", "Code");
        CREATE TABLE "Holds" (
          "Id" serial PRIMARY KEY,
          "CompanyId" integer NOT NULL REFERENCES "Companies"("Id"),
          "EventId" integer NOT NULL REFERENCES "Events"("Id"),
          "SessionId" integer NOT NULL REFERENCES "EventSessions"("Id"),
          "CategoryId" integer NOT NULL REFERENCES "SeatCategories"("Id"),
          "CustomerId" integer NOT NULL REFERENCES "Customers"("Id"),
          "Quantity" integer NOT NULL,
          "Status" text NOT NULL DEFAULT 'Active',
          "ExpiresAt" timestamptz NOT NULL,
          "CreatedAt" timestamptz NOT NULL
        );
        CREATE INDEX "Holds_SessionCategory_Idx" ON "Holds"("SessionId", "CategoryId");
        CREATE TABLE "Purchases" (
          "Id" serial PRIMARY KEY,
          "CompanyId" integer NOT NULL REFERENCES "Companies"("Id"),
          "EventId" integer NOT NULL REFERENCES "Events"("Id"),
          "CustomerId" integer NOT NULL REFERENCES "Customers"("Id"),
          "HoldId" integer UNIQUE REFERENCES "Holds"("Id"),
          "Total" numeric(14,2) NOT NULL,
          "Discount" numeric(14,2) NOT NULL,
          "CreatedAt" timestamptz NOT NULL
        );
        CREATE TABLE "Tickets" (
          "Id" serial PRIMARY KEY,
          "CompanyId" integer NOT NULL REFERENCES "Companies"("Id"),
          "PurchaseId" integer NOT NULL REFERENCES "Purchases"("Id"),
          "EventId" integer NOT NULL REFERENCES "Events"("Id"),
          "SessionId" integer NOT NULL REFERENCES "EventSessions"("Id"),
          "CategoryId" integer NOT NULL REFERENCES "SeatCategories"("Id"),
          "HolderCustomerId" integer NOT NULL REFERENCES "Customers"("Id"),
          "Price" numeric(12,2) NOT NULL,
          "Code" text NOT NULL,
          "Status" text NOT NULL DEFAULT 'Valid',
          "CheckedInAt" timestamptz,
          "CreatedAt" timestamptz NOT NULL
        );
        CREATE UNIQUE INDEX "Tickets_Code_Unique" ON "Tickets"("Code");
        CREATE INDEX "Tickets_Event_Idx" ON "Tickets"("EventId");
        CREATE INDEX "Tickets_SessionCategory_Idx" ON "Tickets"("SessionId", "CategoryId");
        CREATE TABLE "Refunds" (
          "Id" serial PRIMARY KEY,
          "CompanyId" integer NOT NULL REFERENCES "Companies"("Id"),
          "TicketId" integer NOT NULL UNIQUE REFERENCES "Tickets"("Id"),
          "EventId" integer NOT NULL REFERENCES "Events"("Id"),
          "Amount" numeric(12,2) NOT NULL,
          "CreatedAt" timestamptz NOT NULL
        );
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
