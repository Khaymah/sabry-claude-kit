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
    GroupId: integer("GroupId"),
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

export const CustomerGroups = pgTable(
  "CustomerGroups",
  {
    Id: serial("Id").primaryKey(),
    CompanyId: integer("CompanyId").notNull().references(() => Companies.Id),
    Name: text("Name").notNull(),
    ApprovalThreshold: numeric("ApprovalThreshold", { precision: 12, scale: 2 }).notNull(),
    IsDefault: boolean("IsDefault").notNull().default(false),
    CreatedAt: timestamp("CreatedAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (T) => [index("CustomerGroups_CompanyId_Idx").on(T.CompanyId)],
);

export const PriceLists = pgTable(
  "PriceLists",
  {
    Id: serial("Id").primaryKey(),
    CompanyId: integer("CompanyId").notNull().references(() => Companies.Id),
    CustomerId: integer("CustomerId").notNull().references(() => Customers.Id),
    ValidFrom: date("ValidFrom").notNull(),
    ValidTo: date("ValidTo"),
    CreatedAt: timestamp("CreatedAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (T) => [index("PriceLists_Customer_Idx").on(T.CustomerId)],
);

export const PriceListItems = pgTable(
  "PriceListItems",
  {
    Id: serial("Id").primaryKey(),
    PriceListId: integer("PriceListId").notNull().references(() => PriceLists.Id),
    ProductId: integer("ProductId").notNull().references(() => Products.Id),
    Price: numeric("Price", { precision: 12, scale: 2 }).notNull(),
  },
  (T) => [uniqueIndex("PriceListItems_Unique").on(T.PriceListId, T.ProductId)],
);

export const Quotes = pgTable(
  "Quotes",
  {
    Id: serial("Id").primaryKey(),
    CompanyId: integer("CompanyId").notNull().references(() => Companies.Id),
    CustomerId: integer("CustomerId").notNull().references(() => Customers.Id),
    SalespersonId: integer("SalespersonId").notNull().references(() => Users.Id),
    Status: text("Status").notNull().default("Draft"),
    Version: integer("Version").notNull().default(1),
    ValidUntil: date("ValidUntil").notNull(),
    ApprovedBy: integer("ApprovedBy").references(() => Users.Id),
    ApprovedAt: timestamp("ApprovedAt", { withTimezone: true }),
    OrderId: integer("OrderId").references(() => Orders.Id),
    CreatedAt: timestamp("CreatedAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (T) => [index("Quotes_CompanyId_Idx").on(T.CompanyId)],
);

export const QuoteVersions = pgTable(
  "QuoteVersions",
  {
    Id: serial("Id").primaryKey(),
    QuoteId: integer("QuoteId").notNull().references(() => Quotes.Id),
    Version: integer("Version").notNull(),
    Subtotal: numeric("Subtotal", { precision: 12, scale: 2 }).notNull(),
    Tax: numeric("Tax", { precision: 12, scale: 2 }).notNull(),
    Total: numeric("Total", { precision: 12, scale: 2 }).notNull(),
    CreatedAt: timestamp("CreatedAt", { withTimezone: true }).notNull(),
  },
  (T) => [uniqueIndex("QuoteVersions_Unique").on(T.QuoteId, T.Version)],
);

export const QuoteLines = pgTable(
  "QuoteLines",
  {
    Id: serial("Id").primaryKey(),
    QuoteVersionId: integer("QuoteVersionId").notNull().references(() => QuoteVersions.Id),
    ProductId: integer("ProductId").notNull().references(() => Products.Id),
    Quantity: integer("Quantity").notNull(),
    DiscountPercent: numeric("DiscountPercent", { precision: 5, scale: 2 }).notNull().default("0.00"),
    UnitPrice: numeric("UnitPrice", { precision: 12, scale: 2 }).notNull(),
    LineTotal: numeric("LineTotal", { precision: 12, scale: 2 }).notNull(),
  },
  (T) => [index("QuoteLines_Version_Idx").on(T.QuoteVersionId)],
);

export const QuoteSettings = pgTable("QuoteSettings", {
  CompanyId: integer("CompanyId").primaryKey().references(() => Companies.Id),
  ValidityDays: integer("ValidityDays").notNull(),
});
