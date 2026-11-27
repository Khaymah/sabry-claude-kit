import { Hono } from "hono";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody, ParseId, ParseQuery } from "../../Lib/Validate";
import { CreateExpenseBody, MonthQuery } from "./Expenses.Schema";
import * as ExpensesService from "./Expenses.Service";

export const ExpensesRoutes = new Hono<AppEnv>();
ExpensesRoutes.use("*", RequireAuth);

ExpensesRoutes.get("/", async (C) => Ok(C, await ExpensesService.ListExpenses(C.get("Auth").CompanyId, ParseQuery(C, MonthQuery).Month)));

ExpensesRoutes.get("/Totals", async (C) => Ok(C, await ExpensesService.MonthlyTotals(C.get("Auth").CompanyId, ParseQuery(C, MonthQuery).Month)));

ExpensesRoutes.post("/", async (C) => {
  const Body = await ParseBody(C, CreateExpenseBody);
  return Ok(C, await ExpensesService.CreateExpense(C.get("Auth").CompanyId, Body), 201);
});

ExpensesRoutes.delete("/:Id", async (C) => Ok(C, await ExpensesService.DeleteExpense(C.get("Auth").CompanyId, ParseId(C.req.param("Id")))));
