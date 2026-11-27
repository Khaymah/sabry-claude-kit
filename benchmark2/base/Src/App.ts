import { Hono } from "hono";
import { AppError, Fail } from "./Lib/Response";
import type { AppEnv } from "./Middleware/Auth";
import { AuthRoutes } from "./Modules/Auth/Auth.Routes";
import { UsersRoutes } from "./Modules/Users/Users.Routes";
import { SuppliersRoutes } from "./Modules/Suppliers/Suppliers.Routes";
import { PurchasingRoutes } from "./Modules/Purchasing/Purchasing.Routes";
import { ExpensesRoutes } from "./Modules/Expenses/Expenses.Routes";
import { CustomersRoutes } from "./Modules/Customers/Customers.Routes";
import { ProductsRoutes } from "./Modules/Products/Products.Routes";
import { OrdersRoutes } from "./Modules/Orders/Orders.Routes";
import { PaymentsRoutes } from "./Modules/Payments/Payments.Routes";

export const App = new Hono<AppEnv>();

App.get("/Health", (C) => C.json({ Success: true, Data: { Ok: true } }));
App.route("/Auth", AuthRoutes);
App.route("/Users", UsersRoutes);
App.route("/Suppliers", SuppliersRoutes);
App.route("/PurchaseOrders", PurchasingRoutes);
App.route("/Expenses", ExpensesRoutes);
App.route("/Customers", CustomersRoutes);
App.route("/Products", ProductsRoutes);
App.route("/Orders", OrdersRoutes);
App.route("/Payments", PaymentsRoutes);

App.notFound((C) => Fail(C, 404, "NOT_FOUND", "Route not found"));
App.onError((Err, C) => {
  if (Err instanceof AppError) return Fail(C, Err.Status, Err.Code, Err.message);
  console.error(Err);
  return Fail(C, 500, "INTERNAL_ERROR", "Something went wrong");
});
