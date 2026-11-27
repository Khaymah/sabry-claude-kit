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
    Id: "0002_Hr",
    Up: async (Client) => {
      await Client.exec(`
        ALTER TABLE "Users"
          ADD COLUMN "MonthlySalary" numeric(12,2) NOT NULL DEFAULT 0,
          ADD COLUMN "ShiftStart" text NOT NULL DEFAULT '09:00',
          ADD COLUMN "ShiftEnd" text NOT NULL DEFAULT '17:00',
          ADD COLUMN "AnnualLeaveLeft" integer NOT NULL DEFAULT 21 CHECK ("AnnualLeaveLeft" >= 0);
        CREATE TABLE "Punches" (
          "Id" serial PRIMARY KEY,
          "CompanyId" integer NOT NULL REFERENCES "Companies"("Id"),
          "UserId" integer NOT NULL REFERENCES "Users"("Id"),
          "WorkDay" date NOT NULL,
          "InAt" timestamptz NOT NULL,
          "OutAt" timestamptz,
          "ShiftStart" text NOT NULL,
          "ShiftEnd" text NOT NULL
        );
        CREATE INDEX "Punches_UserDay_Idx" ON "Punches"("UserId", "WorkDay");
        CREATE VIEW "PunchMinutes" AS
          SELECT P.*,
            (ceil(greatest(0, floor(extract(epoch FROM (P."InAt" - ((P."WorkDay" + P."ShiftStart"::time) AT TIME ZONE 'Africa/Cairo'))) / 60)) / 15.0) * 15)::int AS "LateMinutes",
            CASE WHEN P."OutAt" IS NULL THEN 0 ELSE
              (floor(greatest(0, floor(extract(epoch FROM (P."OutAt" - (((P."WorkDay" + CASE WHEN P."ShiftEnd" <= P."ShiftStart" THEN 1 ELSE 0 END) + P."ShiftEnd"::time) AT TIME ZONE 'Africa/Cairo'))) / 60)) / 15.0) * 15)::int
            END AS "OvertimeMinutes"
          FROM "Punches" P;
        CREATE TABLE "LeaveRequests" (
          "Id" serial PRIMARY KEY,
          "CompanyId" integer NOT NULL REFERENCES "Companies"("Id"),
          "UserId" integer NOT NULL REFERENCES "Users"("Id"),
          "Kind" text NOT NULL,
          "FirstDay" date NOT NULL,
          "LastDay" date NOT NULL,
          "DayCount" integer NOT NULL,
          "CreatedAt" timestamptz NOT NULL DEFAULT now(),
          "CancelledAt" timestamptz
        );
        CREATE INDEX "LeaveRequests_UserId_Idx" ON "LeaveRequests"("UserId");
        CREATE TABLE "PayrollRuns" (
          "Id" serial PRIMARY KEY,
          "CompanyId" integer NOT NULL REFERENCES "Companies"("Id"),
          "Month" text NOT NULL,
          "Lines" jsonb NOT NULL DEFAULT '[]',
          "CreatedAt" timestamptz NOT NULL DEFAULT now(),
          "VoidedAt" timestamptz
        );
        CREATE TABLE "PayrollMonths" (
          "CompanyId" integer NOT NULL REFERENCES "Companies"("Id"),
          "Month" text NOT NULL,
          "LiveRunId" integer REFERENCES "PayrollRuns"("Id"),
          PRIMARY KEY ("CompanyId", "Month")
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
