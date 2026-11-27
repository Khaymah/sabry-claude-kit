import { pgTable, serial, integer, text, boolean, timestamp, numeric, jsonb, uniqueIndex, index, date, primaryKey } from "drizzle-orm/pg-core";

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
    PhoneKey: text("PhoneKey"),
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

export const Organizers = pgTable("Organizers", {
  Id: serial("Id").primaryKey(),
  CompanyId: integer("CompanyId").notNull().references(() => Companies.Id),
  Name: text("Name").notNull(),
});

export const StaffAssignments = pgTable(
  "StaffAssignments",
  {
    Id: serial("Id").primaryKey(),
    OrganizerId: integer("OrganizerId").notNull().references(() => Organizers.Id),
    UserId: integer("UserId").notNull().references(() => Users.Id),
  },
  (T) => [uniqueIndex("StaffAssignments_Unique").on(T.OrganizerId, T.UserId)],
);

export const Events = pgTable("Events", {
  Id: serial("Id").primaryKey(),
  CompanyId: integer("CompanyId").notNull().references(() => Companies.Id),
  OrganizerId: integer("OrganizerId").notNull().references(() => Organizers.Id),
  Name: text("Name").notNull(),
  Status: text("Status").notNull(),
  Promos: jsonb("Promos").$type<Record<string, number>>().notNull(),
  CreatedAt: timestamp("CreatedAt", { withTimezone: true }).notNull(),
  CancelledAt: timestamp("CancelledAt", { withTimezone: true }),
});

export const EventSessions = pgTable("EventSessions", {
  Id: serial("Id").primaryKey(),
  EventId: integer("EventId").notNull().references(() => Events.Id),
  StartsAt: timestamp("StartsAt", { withTimezone: true }).notNull(),
});

export const SeatCategories = pgTable("SeatCategories", {
  Id: serial("Id").primaryKey(),
  EventId: integer("EventId").notNull().references(() => Events.Id),
  Name: text("Name").notNull(),
  PricePiasters: integer("PricePiasters").notNull(),
  Capacity: integer("Capacity").notNull(),
});

export const Inventory = pgTable(
  "Inventory",
  {
    SessionId: integer("SessionId").notNull().references(() => EventSessions.Id),
    CategoryId: integer("CategoryId").notNull().references(() => SeatCategories.Id),
    Capacity: integer("Capacity").notNull(),
    Sold: integer("Sold").notNull(),
  },
  (T) => [primaryKey({ columns: [T.SessionId, T.CategoryId] })],
);

export const Holds = pgTable("Holds", {
  Id: serial("Id").primaryKey(),
  CompanyId: integer("CompanyId").notNull().references(() => Companies.Id),
  EventId: integer("EventId").notNull().references(() => Events.Id),
  SessionId: integer("SessionId").notNull(),
  CategoryId: integer("CategoryId").notNull(),
  CustomerId: integer("CustomerId").notNull().references(() => Customers.Id),
  Quantity: integer("Quantity").notNull(),
  Status: text("Status").notNull(),
  ExpiresAt: timestamp("ExpiresAt", { withTimezone: true }).notNull(),
});

export const TicketOrders = pgTable("TicketOrders", {
  Id: serial("Id").primaryKey(),
  CompanyId: integer("CompanyId").notNull().references(() => Companies.Id),
  EventId: integer("EventId").notNull().references(() => Events.Id),
  CustomerId: integer("CustomerId").notNull().references(() => Customers.Id),
  HoldId: integer("HoldId"),
  TotalPiasters: integer("TotalPiasters").notNull(),
  DiscountPiasters: integer("DiscountPiasters").notNull(),
  CreatedAt: timestamp("CreatedAt", { withTimezone: true }).notNull(),
});

export const Tickets = pgTable("Tickets", {
  Id: serial("Id").primaryKey(),
  CompanyId: integer("CompanyId").notNull().references(() => Companies.Id),
  OrderId: integer("OrderId").notNull().references(() => TicketOrders.Id),
  EventId: integer("EventId").notNull().references(() => Events.Id),
  SessionId: integer("SessionId").notNull(),
  CategoryId: integer("CategoryId").notNull(),
  HolderCustomerId: integer("HolderCustomerId").notNull().references(() => Customers.Id),
  PaidPiasters: integer("PaidPiasters").notNull(),
  Code: text("Code").notNull().unique(),
  Status: text("Status").notNull(),
  CheckedInAt: timestamp("CheckedInAt", { withTimezone: true }),
  RefundPiasters: integer("RefundPiasters"),
  RefundedAt: timestamp("RefundedAt", { withTimezone: true }),
  CreatedAt: timestamp("CreatedAt", { withTimezone: true }).notNull(),
});
