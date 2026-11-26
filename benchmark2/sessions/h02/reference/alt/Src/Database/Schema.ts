import { pgTable, serial, integer, text, boolean, timestamp, numeric, jsonb, uniqueIndex, index, date } from "drizzle-orm/pg-core";

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

export const Suppliers = pgTable("Suppliers", {
  Id: serial("Id").primaryKey(),
  CompanyId: integer("CompanyId").notNull().references(() => Companies.Id),
  Name: text("Name").notNull(),
  Phone: text("Phone"),
  CreatedAt: timestamp("CreatedAt", { withTimezone: true }).notNull().defaultNow(),
});

export const PurchaseOrders = pgTable("PurchaseOrders", {
  Id: serial("Id").primaryKey(),
  CompanyId: integer("CompanyId").notNull().references(() => Companies.Id),
  SupplierId: integer("SupplierId").notNull().references(() => Suppliers.Id),
  Status: text("Status").notNull().default("Draft"),
  Total: numeric("Total", { precision: 12, scale: 2 }).notNull(),
  CreatedAt: timestamp("CreatedAt", { withTimezone: true }).notNull().defaultNow(),
  ReceivedAt: timestamp("ReceivedAt", { withTimezone: true }),
});

export const PurchaseOrderItems = pgTable("PurchaseOrderItems", {
  Id: serial("Id").primaryKey(),
  PurchaseOrderId: integer("PurchaseOrderId").notNull().references(() => PurchaseOrders.Id),
  ProductId: integer("ProductId").notNull().references(() => Products.Id),
  Quantity: integer("Quantity").notNull(),
  UnitCost: numeric("UnitCost", { precision: 12, scale: 2 }).notNull(),
  LineTotal: numeric("LineTotal", { precision: 12, scale: 2 }).notNull(),
});

export const StockMovements = pgTable("StockMovements", {
  Id: serial("Id").primaryKey(),
  CompanyId: integer("CompanyId").notNull().references(() => Companies.Id),
  ProductId: integer("ProductId").notNull().references(() => Products.Id),
  Change: integer("Change").notNull(),
  Reason: text("Reason").notNull(),
  RefId: integer("RefId"),
  CreatedAt: timestamp("CreatedAt", { withTimezone: true }).notNull().defaultNow(),
});

export const Expenses = pgTable("Expenses", {
  Id: serial("Id").primaryKey(),
  CompanyId: integer("CompanyId").notNull().references(() => Companies.Id),
  Category: text("Category").notNull(),
  Amount: numeric("Amount", { precision: 12, scale: 2 }).notNull(),
  SpentOn: date("SpentOn").notNull(),
  Note: text("Note"),
  CreatedAt: timestamp("CreatedAt", { withTimezone: true }).notNull().defaultNow(),
});

export const AuditLogs = pgTable("AuditLogs", {
  Id: serial("Id").primaryKey(),
  CompanyId: integer("CompanyId").notNull().references(() => Companies.Id),
  UserId: integer("UserId"),
  Action: text("Action").notNull(),
  Entity: text("Entity").notNull(),
  EntityId: integer("EntityId"),
  CreatedAt: timestamp("CreatedAt", { withTimezone: true }).notNull().defaultNow(),
});

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

export const Plans = pgTable("Plans", {
  Id: serial("Id").primaryKey(),
  CompanyId: integer("CompanyId").notNull().references(() => Companies.Id),
  Name: text("Name").notNull(),
  PricePiasters: integer("PricePiasters").notNull(),
  IntervalMonths: integer("IntervalMonths").notNull(),
});

export const Subscriptions = pgTable("Subscriptions", {
  Id: serial("Id").primaryKey(),
  CompanyId: integer("CompanyId").notNull().references(() => Companies.Id),
  CustomerId: integer("CustomerId").notNull().references(() => Customers.Id),
  PlanId: integer("PlanId").notNull().references(() => Plans.Id),
  Status: text("Status").notNull(),
  StartDate: date("StartDate").notNull(),
});

export const Coupons = pgTable("Coupons", {
  Id: serial("Id").primaryKey(),
  CompanyId: integer("CompanyId").notNull().references(() => Companies.Id),
  Code: text("Code").notNull(),
  PercentOff: integer("PercentOff").notNull(),
  MaxRedemptions: integer("MaxRedemptions").notNull(),
  Used: integer("Used").notNull(),
});

export const BillingInvoices = pgTable("BillingInvoices", {
  Id: serial("Id").primaryKey(),
  CompanyId: integer("CompanyId").notNull().references(() => Companies.Id),
  SubscriptionId: integer("SubscriptionId").notNull().references(() => Subscriptions.Id),
  Source: text("Source").notNull(),
  PeriodNo: integer("PeriodNo"),
  PeriodStart: date("PeriodStart").notNull(),
  PeriodEnd: date("PeriodEnd").notNull(),
  DueDate: date("DueDate").notNull(),
  GrossPiasters: integer("GrossPiasters").notNull(),
  DiscountPiasters: integer("DiscountPiasters").notNull(),
  CouponId: integer("CouponId"),
  State: text("State").notNull(),
});

export const MoneyMovements = pgTable("MoneyMovements", {
  Id: serial("Id").primaryKey(),
  CompanyId: integer("CompanyId").notNull().references(() => Companies.Id),
  InvoiceId: integer("InvoiceId").notNull().references(() => BillingInvoices.Id),
  Direction: text("Direction").notNull(),
  Piasters: integer("Piasters").notNull(),
  Method: text("Method"),
  Note: text("Note"),
  At: timestamp("At", { withTimezone: true }).notNull(),
});
