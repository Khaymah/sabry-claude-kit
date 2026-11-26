import { pgTable, serial, integer, text, boolean, timestamp, numeric, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";

export const Companies = pgTable("Companies", {
  Id: serial("Id").primaryKey(),
  Name: text("Name").notNull(),
  CreatedAt: timestamp("CreatedAt", { withTimezone: true }).notNull().defaultNow(),
});

export const Users = pgTable(
  "Users",
  {
    Id: serial("Id").primaryKey(),
    CompanyId: integer("CompanyId").notNull().references(() => Companies.Id),
    Email: text("Email").notNull(),
    Name: text("Name").notNull(),
    PasswordHash: text("PasswordHash").notNull(),
    Role: text("Role").notNull().default("Staff"),
    IsActive: boolean("IsActive").notNull().default(true),
    CreatedAt: timestamp("CreatedAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (T) => [uniqueIndex("Users_Email_Unique").on(T.Email)],
);

export const Sessions = pgTable("Sessions", {
  Id: serial("Id").primaryKey(),
  Token: text("Token").notNull().unique(),
  UserId: integer("UserId").notNull().references(() => Users.Id),
  CreatedAt: timestamp("CreatedAt", { withTimezone: true }).notNull().defaultNow(),
  ExpiresAt: timestamp("ExpiresAt", { withTimezone: true }).notNull(),
});

export const Customers = pgTable(
  "Customers",
  {
    Id: serial("Id").primaryKey(),
    CompanyId: integer("CompanyId").notNull().references(() => Companies.Id),
    Name: text("Name").notNull(),
    Phone: text("Phone"),
    Email: text("Email"),
    WalletBalance: numeric("WalletBalance", { precision: 12, scale: 2 }).notNull().default("0.00"),
    CreatedAt: timestamp("CreatedAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (T) => [index("Customers_CompanyId_Idx").on(T.CompanyId)],
);

export const Products = pgTable(
  "Products",
  {
    Id: serial("Id").primaryKey(),
    CompanyId: integer("CompanyId").notNull().references(() => Companies.Id),
    Name: text("Name").notNull(),
    Sku: text("Sku").notNull(),
    Price: numeric("Price", { precision: 12, scale: 2 }).notNull(),
    Stock: integer("Stock").notNull().default(0),
    IsActive: boolean("IsActive").notNull().default(true),
    CreatedAt: timestamp("CreatedAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (T) => [uniqueIndex("Products_CompanySku_Unique").on(T.CompanyId, T.Sku)],
);

export const Orders = pgTable(
  "Orders",
  {
    Id: serial("Id").primaryKey(),
    CompanyId: integer("CompanyId").notNull().references(() => Companies.Id),
    CustomerId: integer("CustomerId").notNull().references(() => Customers.Id),
    Status: text("Status").notNull().default("Pending"),
    Subtotal: numeric("Subtotal", { precision: 12, scale: 2 }).notNull(),
    Discount: numeric("Discount", { precision: 12, scale: 2 }).notNull().default("0.00"),
    Tax: numeric("Tax", { precision: 12, scale: 2 }).notNull(),
    Total: numeric("Total", { precision: 12, scale: 2 }).notNull(),
    Note: text("Note"),
    CreatedAt: timestamp("CreatedAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (T) => [index("Orders_CompanyId_Idx").on(T.CompanyId)],
);

export const OrderItems = pgTable("OrderItems", {
  Id: serial("Id").primaryKey(),
  OrderId: integer("OrderId").notNull().references(() => Orders.Id),
  ProductId: integer("ProductId").notNull().references(() => Products.Id),
  Quantity: integer("Quantity").notNull(),
  UnitPrice: numeric("UnitPrice", { precision: 12, scale: 2 }).notNull(),
  LineTotal: numeric("LineTotal", { precision: 12, scale: 2 }).notNull(),
});

export const Payments = pgTable("Payments", {
  Id: serial("Id").primaryKey(),
  CompanyId: integer("CompanyId").notNull().references(() => Companies.Id),
  OrderId: integer("OrderId").notNull().references(() => Orders.Id),
  Amount: numeric("Amount", { precision: 12, scale: 2 }).notNull(),
  Method: text("Method").notNull(),
  Status: text("Status").notNull().default("Completed"),
  ProviderRef: text("ProviderRef"),
  CreatedAt: timestamp("CreatedAt", { withTimezone: true }).notNull().defaultNow(),
});

export const SystemSettings = pgTable("SystemSettings", {
  Key: text("Key").primaryKey(),
  Value: jsonb("Value").notNull(),
  UpdatedAt: timestamp("UpdatedAt", { withTimezone: true }).notNull().defaultNow(),
});
